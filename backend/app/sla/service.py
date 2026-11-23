import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.automation.publisher import OutboxEventPublisher
from app.automation.schemas import EventType
from app.incidents.models import Incident
from app.sla.clock import require_utc
from app.sla.models import Escalation
from app.sla.policy import calculate_deadline

ESCALATION_REASON = "Acknowledgement SLA exceeded"


class SlaEscalationService:
    """Atomically create acknowledgement SLA escalations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def check(self, now: datetime | None = None) -> tuple[int, int]:
        checked_at = require_utc(now or datetime.now(UTC))
        request_id = uuid.uuid4()

        candidate_ids = self.db.scalars(
            select(Incident.id)
            .where(
                Incident.status.in_(("reported", "assigned")),
                Incident.priority.is_not(None),
                Incident.acknowledged_at.is_(None),
                Incident.resolved_at.is_(None),
                Incident.closed_at.is_(None),
            )
            .order_by(Incident.reported_at, Incident.id)
        ).all()

        checked_count = 0
        escalations_created = 0

        for incident_id in candidate_ids:
            incident = self.db.scalar(
                select(Incident)
                .where(Incident.id == incident_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )

            if incident is None:
                continue

            checked_count += 1

            # Recheck all mutable conditions after acquiring the row lock.
            if (
                incident.status not in ("reported", "assigned")
                or incident.acknowledged_at is not None
                or incident.resolved_at is not None
                or incident.closed_at is not None
                or incident.priority is None
            ):
                continue

            # W7 currently defines one acknowledgement escalation level.
            # Do not create another record when a scheduled job is retried.
            if incident.escalation_level >= 1:
                continue

            deadline = incident.acknowledgment_deadline_at
            if deadline is None:
                deadline = calculate_deadline(
                    incident.reported_at,
                    incident.priority,
                )

            deadline = require_utc(deadline)

            if checked_at < deadline:
                continue

            existing = self.db.scalar(
                select(Escalation.id).where(
                    Escalation.incident_id == incident.id,
                    Escalation.level == 1,
                )
            )
            if existing is not None:
                incident.escalation_level = max(incident.escalation_level, 1)
                continue

            self.db.add(
                Escalation(
                    incident_id=incident.id,
                    level=1,
                    priority=incident.priority,
                    deadline_at=deadline,
                    escalated_at=checked_at,
                    reason=ESCALATION_REASON,
                )
            )

            incident.escalation_level = 1

            OutboxEventPublisher(self.db).create_and_publish(
                event_type=EventType.SLA_ESCALATED,
                incident_id=incident.id,
                request_id=request_id,
                occurred_at=checked_at,
            )

            self.db.flush()
            escalations_created += 1

        return checked_count, escalations_created
