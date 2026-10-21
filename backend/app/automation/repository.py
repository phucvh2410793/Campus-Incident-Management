import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.automation.models import Notification, OutboxEvent
from app.automation.publisher import IdempotencyConflictError
from app.automation.schemas import EventEnvelope


def _utc_now() -> datetime:
    return datetime.now(UTC)


class OutboxRepository:
    """Repository handling atomic persistence, lease claims, and lifecycle for outbox events."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def save_event(self, envelope: EventEnvelope) -> OutboxEvent:
        """Persist an event envelope into the outbox within the current transaction."""
        existing = self.session.get(OutboxEvent, envelope.event_id)
        if existing:
            # Check idempotency
            if (
                existing.event_type == envelope.event_type.value
                and existing.incident_id == envelope.incident_id
                and existing.request_id == envelope.request_id
            ):
                return existing
            raise IdempotencyConflictError(
                f"Outbox event with ID '{envelope.event_id}' already exists with different payload."
            )

        payload_dict = envelope.model_dump(mode="json")
        record = OutboxEvent(
            id=envelope.event_id,
            event_type=envelope.event_type.value,
            incident_id=envelope.incident_id,
            request_id=envelope.request_id,
            occurred_at=envelope.occurred_at,
            schema_version=envelope.schema_version,
            status="pending",
            payload=payload_dict,
            attempt_count=0,
            max_attempts=5,
            lease_token=None,
            lease_expires_at=None,
            last_attempt_at=None,
            next_attempt_at=None,
            error_message=None,
        )
        self.session.add(record)
        return record

    def claim_events(
        self,
        limit: int = 10,
        lease_duration_seconds: int = 60,
        worker_id: str | None = None,
        now: datetime | None = None,
    ) -> list[OutboxEvent]:
        """Claim a batch of eligible outbox events with a lease lock.

        Eligible events:
        1. status == 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now)
        2. status == 'processing' AND lease_expires_at <= now (lease expired / timed out)
        """
        current_time = now or _utc_now()
        token = worker_id or str(uuid.uuid4())
        lease_until = current_time + timedelta(seconds=lease_duration_seconds)

        # Query eligible events
        query = (
            sa.select(OutboxEvent)
            .where(
                sa.or_(
                    sa.and_(
                        OutboxEvent.status == "pending",
                        sa.or_(
                            OutboxEvent.next_attempt_at.is_(None),
                            OutboxEvent.next_attempt_at <= current_time,
                        ),
                    ),
                    sa.and_(
                        OutboxEvent.status == "processing",
                        OutboxEvent.lease_expires_at.is_not(None),
                        OutboxEvent.lease_expires_at <= current_time,
                    ),
                )
            )
            .order_by(OutboxEvent.created_at.asc())
            .limit(limit)
        )

        # In PostgreSQL use FOR UPDATE SKIP LOCKED if supported by dialect
        bind = self.session.get_bind()
        if bind and bind.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)

        events = list(self.session.scalars(query).all())

        for ev in events:
            ev.status = "processing"
            ev.lease_token = token
            ev.lease_expires_at = lease_until
            ev.attempt_count += 1
            ev.last_attempt_at = current_time

        self.session.flush()
        return events

    def complete_event(
        self,
        event_id: uuid.UUID,
        lease_token: str | None = None,
        now: datetime | None = None,
    ) -> bool:
        """Mark an event as done, releasing the lease."""
        current_time = now or _utc_now()
        record = self.session.get(OutboxEvent, event_id)
        if not record:
            return False

        if lease_token is not None and record.lease_token != lease_token:
            return False

        record.status = "done"
        record.lease_token = None
        record.lease_expires_at = None
        record.updated_at = current_time
        self.session.flush()
        return True

    def fail_event(
        self,
        event_id: uuid.UUID,
        error_message: str,
        lease_token: str | None = None,
        backoff_base_seconds: int = 5,
        now: datetime | None = None,
    ) -> bool:
        """Record an attempt failure. Retries with exponential backoff or marks as failed."""
        current_time = now or _utc_now()
        record = self.session.get(OutboxEvent, event_id)
        if not record:
            return False

        if lease_token is not None and record.lease_token != lease_token:
            return False

        # Sanitize error message to ensure no sensitive passwords/secrets are logged
        clean_msg = error_message[:1000] if error_message else "Unknown error"

        if record.attempt_count < record.max_attempts:
            # Exponential backoff: base * 2^(attempt - 1)
            backoff_sec = backoff_base_seconds * (2 ** max(0, record.attempt_count - 1))
            record.status = "pending"
            record.next_attempt_at = current_time + timedelta(seconds=backoff_sec)
        else:
            record.status = "failed"
            record.next_attempt_at = None

        record.lease_token = None
        record.lease_expires_at = None
        record.error_message = clean_msg
        record.updated_at = current_time
        self.session.flush()
        return True

    def retry_event_admin(
        self,
        event_id: uuid.UUID,
        reason: str,
        now: datetime | None = None,
    ) -> bool:
        """Allow administrators to re-queue a failed event with a reason (API contract).

        Idempotent if the event is already pending or done.
        """
        current_time = now or _utc_now()
        record = self.session.get(OutboxEvent, event_id)
        if not record:
            return False

        if record.status in ("pending", "done"):
            return True  # Idempotently accepted

        record.status = "pending"
        record.attempt_count = 0
        record.next_attempt_at = current_time
        record.lease_token = None
        record.lease_expires_at = None
        record.error_message = f"Admin retry: {reason.strip()}"
        record.updated_at = current_time
        self.session.flush()
        return True

    def get_event(self, event_id: uuid.UUID) -> OutboxEvent | None:
        return self.session.get(OutboxEvent, event_id)


class NotificationRepository:
    """Repository handling idempotency claims and completion tracking for notifications."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def claim_notification(
        self,
        event_id: uuid.UUID,
        kind: str,
        recipient_user_id: uuid.UUID,
        now: datetime | None = None,
    ) -> tuple[Notification, bool]:
        """Claim a notification delivery task.

        Returns (notification, should_send):
        - If not yet claimed, creates notification with status='pending' and returns (notif, True)
        - If already claimed, returns (existing_notif, False)
        """
        current_time = now or _utc_now()
        stmt = sa.select(Notification).where(
            Notification.event_id == event_id,
            Notification.kind == kind,
            Notification.recipient_user_id == recipient_user_id,
        )
        existing = self.session.scalars(stmt).first()
        if existing:
            return existing, False

        notification = Notification(
            event_id=event_id,
            kind=kind,
            recipient_user_id=recipient_user_id,
            status="pending",
            provider_message_id=None,
            error_message=None,
            created_at=current_time,
            updated_at=current_time,
        )
        self.session.add(notification)
        self.session.flush()
        return notification, True

    def complete_notification(
        self,
        notification_id: uuid.UUID,
        status: str,
        provider_message_id: str | None = None,
        error_message: str | None = None,
        now: datetime | None = None,
    ) -> Notification | None:
        """Record final status of notification (sent, failed, or uncertain).

        Once sent or uncertain, prevents automatic resends.
        """
        current_time = now or _utc_now()
        record = self.session.get(Notification, notification_id)
        if not record:
            return None

        # Guard: do not allow sent or uncertain notifications to be silently overwritten as failed
        if record.status in ("sent", "uncertain") and status not in ("sent", "uncertain"):
            return record

        record.status = status
        if provider_message_id is not None:
            record.provider_message_id = provider_message_id
        if error_message is not None:
            record.error_message = error_message[:1000]
        record.updated_at = current_time
        self.session.flush()
        return record

    def get_notification(self, notification_id: uuid.UUID) -> Notification | None:
        return self.session.get(Notification, notification_id)
