"""Outbox worker: claim-lease, signed dispatch, bounded backoff and crash recovery (N5 W4).

The worker is deliberately synchronous and single-threaded per instance. Horizontal
scale is handled by ``SELECT ... FOR UPDATE SKIP LOCKED`` plus a per-claim lease
token, so several processes can run at once without dispatching the same event twice.

Delivery guarantee is *at-least-once*: the business side (n8n handler and backend
``/internal/*``) must stay idempotent on ``event_id``.
"""

import logging
import signal
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Self

from sqlalchemy.orm import Session, sessionmaker

from app.automation.config import OutboxSettings
from app.automation.models import OutboxEvent
from app.automation.repository import OutboxRepository
from app.automation.webhook import DispatchResult, WebhookDispatcher, sanitize_error_message

logger = logging.getLogger(__name__)

DispatcherCallable = Callable[[OutboxEvent], bool | DispatchResult]


def _as_utc(value: datetime | None) -> datetime | None:
    """Normalize DB datetimes so naive values (SQLite) compare against aware ones."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@dataclass
class WorkerCycleResult:
    """Counters for a single ``step()`` execution."""

    claimed: int = 0
    processed: int = 0
    failed: int = 0
    dead_lettered: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "claimed": self.claimed,
            "processed": self.processed,
            "failed": self.failed,
            "dead_lettered": self.dead_lettered,
        }


class OutboxWorkerStub:
    """Outbox worker implementing claim-lease, retry/backoff and restart recovery.

    Kept under the historical name so existing imports and tests keep working.
    """

    def __init__(
        self,
        session_factory: sessionmaker[Session] | Callable[[], Session],
        dispatcher: DispatcherCallable | None = None,
        batch_size: int = 10,
        lease_duration_seconds: int = 60,
        backoff_base_seconds: int = 5,
        worker_id: str | None = None,
        max_backoff_seconds: int = 300,
        requeue_on_start: bool = True,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.session_factory = session_factory
        self.dispatcher = dispatcher
        self.batch_size = batch_size
        self.lease_duration_seconds = lease_duration_seconds
        self.backoff_base_seconds = backoff_base_seconds
        self.max_backoff_seconds = max_backoff_seconds
        self.requeue_on_start = requeue_on_start
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        self._sleep = sleep
        self._stop = threading.Event()

        if self.dispatcher is None:
            logger.warning(
                "Worker %s started without a webhook dispatcher; events will be "
                "marked done without leaving the process (dev/test only)",
                self.worker_id,
            )

    @classmethod
    def from_settings(
        cls,
        session_factory: sessionmaker[Session] | Callable[[], Session],
        settings: OutboxSettings,
        dispatcher: DispatcherCallable | None = None,
        **kwargs: object,
    ) -> Self:
        return cls(
            session_factory=session_factory,
            dispatcher=dispatcher or WebhookDispatcher.from_settings(settings),
            batch_size=settings.batch_size,
            lease_duration_seconds=settings.lease_duration_seconds,
            backoff_base_seconds=settings.backoff_base_seconds,
            max_backoff_seconds=settings.max_backoff_seconds,
            worker_id=settings.worker_id,
            **kwargs,  # type: ignore[arg-type]
        )

    # ------------------------------------------------------------------
    # Dispatch helpers
    # ------------------------------------------------------------------

    def _default_dispatcher(self, event: OutboxEvent) -> bool:
        """Fallback dispatcher used only when no webhook is configured (tests/dev)."""
        logger.info(
            "Worker %s dispatched event %s (type=%s, incident_id=%s)",
            self.worker_id,
            event.id,
            event.event_type,
            event.incident_id,
        )
        return True

    def _dispatch(self, event: OutboxEvent) -> DispatchResult:
        """Run the configured dispatcher and normalize the result."""
        dispatch_fn = self.dispatcher or self._default_dispatcher
        try:
            result = dispatch_fn(event)
        except Exception as exc:  # noqa: BLE001 - never crash the worker loop
            logger.warning("Error dispatching event %s: %s", event.id, exc)
            return DispatchResult(
                success=False,
                error_code="dispatcher_exception",
                error_message=sanitize_error_message(str(exc)),
                retryable=True,
            )

        if isinstance(result, DispatchResult):
            return result
        return DispatchResult(success=bool(result))

    # ------------------------------------------------------------------
    # Recovery
    # ------------------------------------------------------------------

    def recover_interrupted_events(self, now: datetime | None = None) -> int:
        """Re-queue events whose lease expired, e.g. after a crash or restart.

        Events left in ``processing`` with an expired lease are returned to
        ``pending`` so the next claim picks them up immediately instead of waiting
        for the claim query to notice. No business action is repeated here: the
        event ID remains the idempotency key for n8n and the backend.
        """
        current_time = now or datetime.now(UTC)
        recovered = 0

        with self.session_factory() as session:
            repo = OutboxRepository(session)
            events = repo.list_processing_events(now=current_time)
            for event in events:
                lease_expires_at = _as_utc(event.lease_expires_at)
                if lease_expires_at is not None and lease_expires_at > current_time:
                    continue
                event.status = "pending"
                event.lease_token = None
                event.lease_expires_at = None
                event.next_attempt_at = current_time
                event.error_message = "Recovered after worker restart (lease expired)"
                event.updated_at = current_time
                recovered += 1
            session.commit()

        if recovered:
            logger.warning("Worker %s recovered %d interrupted event(s)", self.worker_id, recovered)
        return recovered

    # ------------------------------------------------------------------
    # Main cycle
    # ------------------------------------------------------------------

    def step(self) -> dict[str, int]:
        """Claim one batch and process each event with its own transaction."""
        return self.run_cycle().as_dict()

    def run_cycle(self) -> WorkerCycleResult:
        counts = WorkerCycleResult()

        with self.session_factory() as session:
            repo = OutboxRepository(session)
            claimed = repo.claim_events(
                limit=self.batch_size,
                lease_duration_seconds=self.lease_duration_seconds,
                worker_id=self.worker_id,
            )
            detached: list[OutboxEvent] = []
            for ev in claimed:
                session.refresh(ev)
                session.expunge(ev)
                detached.append(ev)
            session.commit()

        if not detached:
            return counts

        counts.claimed = len(detached)

        for ev in detached:
            result = self._dispatch(ev)

            with self.session_factory() as session:
                repo = OutboxRepository(session)
                if result.success:
                    completed = repo.complete_event(ev.id, lease_token=self.worker_id)
                    if completed:
                        counts.processed += 1
                    else:
                        # n8n may already have finished the event through
                        # /internal/events/{id}/complete while we held the lease.
                        record = repo.get_event(ev.id)
                        if record is not None and record.status == "done":
                            logger.info(
                                "Event %s was already completed by the workflow callback", ev.id
                            )
                            counts.processed += 1
                        else:
                            # Lease was taken over (expired and reclaimed elsewhere).
                            logger.warning(
                                "Event %s no longer owned by %s; leaving it for the owner",
                                ev.id,
                                self.worker_id,
                            )
                else:
                    repo.fail_event(
                        ev.id,
                        error_message=result.error_message or "Dispatch failed",
                        lease_token=self.worker_id,
                        backoff_base_seconds=self.backoff_base_seconds,
                        max_backoff_seconds=self.max_backoff_seconds,
                        retryable=result.retryable,
                    )
                    record = repo.get_event(ev.id)
                    if record is not None and record.status == "failed":
                        counts.dead_lettered += 1
                    else:
                        counts.failed += 1
                session.commit()

        return counts

    def run_once(self) -> dict[str, int]:
        """Drain the current queue once (bounded by batch size)."""
        return self.run_cycle().as_dict()

    def stop(self) -> None:
        """Ask ``run_forever()`` to exit after the current cycle."""
        self._stop.set()

    def run_forever(
        self,
        poll_interval_seconds: float = 5.0,
        install_signal_handlers: bool = False,
        max_cycles: int | None = None,
    ) -> None:
        """Poll the outbox until ``stop()`` is called.

        Failures in a single cycle are logged and never terminate the loop, so a
        transient database or network outage cannot silently kill automation.
        """
        if install_signal_handlers:
            self._install_signal_handlers()

        if self.requeue_on_start:
            try:
                self.recover_interrupted_events()
            except Exception:  # noqa: BLE001
                logger.exception("Worker %s could not recover interrupted events", self.worker_id)

        cycles = 0
        logger.info(
            "Outbox worker %s started (batch=%d, lease=%ds)",
            self.worker_id,
            self.batch_size,
            self.lease_duration_seconds,
        )

        while not self._stop.is_set():
            try:
                counts = self.run_cycle()
                if counts.claimed:
                    logger.info(
                        "Worker %s cycle: claimed=%d processed=%d retry=%d dead=%d",
                        self.worker_id,
                        counts.claimed,
                        counts.processed,
                        counts.failed,
                        counts.dead_lettered,
                    )
            except Exception:  # noqa: BLE001
                logger.exception("Worker %s cycle failed; retrying after backoff", self.worker_id)

            cycles += 1
            if max_cycles is not None and cycles >= max_cycles:
                break
            if not self._stop.is_set():
                self._sleep(poll_interval_seconds)

        logger.info("Outbox worker %s stopped", self.worker_id)

    def _install_signal_handlers(self) -> None:
        def _handle(signum: int, _frame: object) -> None:  # pragma: no cover - signal path
            logger.warning("Worker %s received signal %s, stopping", self.worker_id, signum)
            self.stop()

        if threading.current_thread() is not threading.main_thread():  # pragma: no cover
            return

        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, _handle)
            except Exception:  # noqa: BLE001 - signal support is platform dependent
                logger.debug("Cannot install handler for signal %s", sig)

    # ------------------------------------------------------------------
    # Admin operations
    # ------------------------------------------------------------------

    def retry_dead_letter(self, event_id: uuid.UUID, reason: str) -> bool:
        """Admin retry of a dead-letter event with an explicit reason."""
        with self.session_factory() as session:
            repo = OutboxRepository(session)
            success = repo.retry_event_admin(event_id, reason=reason)
            session.commit()
            return success

    def reap_expired_leases(self, grace_seconds: int = 0) -> int:
        """Re-queue events whose lease already expired (periodic maintenance)."""
        return self.recover_interrupted_events(
            now=datetime.now(UTC) + timedelta(seconds=grace_seconds)
        )
