import logging
import uuid
from collections.abc import Callable

from sqlalchemy.orm import Session, sessionmaker

from app.automation.models import OutboxEvent
from app.automation.repository import OutboxRepository

logger = logging.getLogger(__name__)

DispatcherCallable = Callable[[OutboxEvent], bool]


class OutboxWorkerStub:
    """Worker stub implementing claim-lease, attempt-backoff, and event dispatching.

    Used by N5 to:
    - Claim pending/expired-lease outbox events atomically
    - Forward events to n8n webhook dispatcher (or mock callable in tests)
    - Mark successful events as 'done' and release lease
    - Mark failed events with exponential backoff or 'failed' (dead-letter)
    - Allow manual or automated recovery
    """

    def __init__(
        self,
        session_factory: sessionmaker[Session] | Callable[[], Session],
        dispatcher: DispatcherCallable | None = None,
        batch_size: int = 10,
        lease_duration_seconds: int = 60,
        backoff_base_seconds: int = 5,
        worker_id: str | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.dispatcher = dispatcher
        self.batch_size = batch_size
        self.lease_duration_seconds = lease_duration_seconds
        self.backoff_base_seconds = backoff_base_seconds
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"

    def _default_dispatcher(self, event: OutboxEvent) -> bool:
        """Simulated default dispatch for development/stubbing."""
        logger.info(
            "Worker %s dispatched event %s (type=%s, incident_id=%s)",
            self.worker_id,
            event.id,
            event.event_type,
            event.incident_id,
        )
        return True

    def step(self) -> dict[str, int]:
        """Perform one execution cycle: claim a batch and process each event."""
        counts = {"claimed": 0, "processed": 0, "failed": 0}

        with self.session_factory() as session:
            repo = OutboxRepository(session)
            claimed = repo.claim_events(
                limit=self.batch_size,
                lease_duration_seconds=self.lease_duration_seconds,
                worker_id=self.worker_id,
            )
            for ev in claimed:
                session.refresh(ev)
                session.expunge(ev)
            session.commit()

        if not claimed:
            return counts

        counts["claimed"] = len(claimed)

        for ev in claimed:
            success = False
            error_message = "Dispatch failed"

            try:
                dispatch_fn = self.dispatcher or self._default_dispatcher
                result = dispatch_fn(ev)
                success = bool(result)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Error dispatching event %s: %s", ev.id, exc)
                error_message = str(exc)
                success = False

            with self.session_factory() as session:
                repo = OutboxRepository(session)
                if success:
                    repo.complete_event(ev.id, lease_token=self.worker_id)
                    counts["processed"] += 1
                else:
                    repo.fail_event(
                        ev.id,
                        error_message=error_message,
                        lease_token=self.worker_id,
                        backoff_base_seconds=self.backoff_base_seconds,
                    )
                    counts["failed"] += 1
                session.commit()

        return counts

    def retry_dead_letter(self, event_id: uuid.UUID, reason: str) -> bool:
        """Admin retry of dead-letter or failed event."""
        with self.session_factory() as session:
            repo = OutboxRepository(session)
            success = repo.retry_event_admin(event_id, reason=reason)
            session.commit()
            return success
