"""Run the outbox dispatcher as a standalone process.

Usage (from ``backend/``)::

    python -m app.automation.run_worker            # run until Ctrl+C / SIGTERM
    python -m app.automation.run_worker --once     # drain the queue once
    python -m app.automation.run_worker --recover  # re-queue expired leases, then exit

Configuration is read from the environment (see ``app.automation.config``):

- ``CIM_OUTBOX_WEBHOOK_URL`` or ``N8N_WEBHOOK_URL`` (default localhost:5678)
- ``CIM_OUTBOX_POLL_INTERVAL_SECONDS``, ``CIM_OUTBOX_BATCH_SIZE``
- ``CIM_OUTBOX_LEASE_SECONDS``, ``CIM_OUTBOX_BACKOFF_BASE_SECONDS``
- ``CIM_WEBHOOK_HMAC_SECRET`` (required outside local development)
"""

import argparse
import logging
import sys
import uuid

from app.automation.config import OutboxSettings
from app.automation.repository import NotificationRepository, OutboxRepository
from app.automation.webhook import sanitize_error_message
from app.automation.worker import OutboxWorkerStub
from app.db import SessionLocal

logger = logging.getLogger(__name__)


def build_worker(settings: OutboxSettings) -> OutboxWorkerStub:
    return OutboxWorkerStub.from_settings(session_factory=SessionLocal, settings=settings)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="CIM outbox dispatcher and dead-letter admin CLI")
    parser.add_argument("--once", action="store_true", help="process one batch and exit")
    parser.add_argument(
        "--recover",
        action="store_true",
        help="re-queue events with expired leases and exit",
    )
    parser.add_argument("--cycles", type=int, default=None, help="stop after N poll cycles")
    parser.add_argument("--log-level", default="INFO")

    # W7 Admin operations
    parser.add_argument("--list-failed", action="store_true", help="list dead-letter outbox events")
    parser.add_argument(
        "--retry-event",
        type=str,
        default=None,
        help="UUID of a failed outbox event to re-queue (requires --reason)",
    )
    parser.add_argument(
        "--list-notifications",
        action="store_true",
        help="list notifications (filter with --status)",
    )
    parser.add_argument(
        "--status",
        type=str,
        default=None,
        help="status filter for --list-notifications (sent/failed/uncertain/pending)",
    )
    parser.add_argument(
        "--retry-notification",
        type=str,
        default=None,
        help="UUID of a failed or uncertain notification to re-queue (requires --reason)",
    )
    parser.add_argument(
        "--reason",
        type=str,
        default=None,
        help="mandatory explanation required for administrative retry operations",
    )
    # W8 Periodic SLA check
    parser.add_argument(
        "--check-sla",
        action="store_true",
        help="trigger one SLA deadline review cycle and report escalations",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    # 1. Admin CLI commands: inspect & retry
    if args.list_failed:
        with SessionLocal() as session:
            repo = OutboxRepository(session)
            failed = repo.list_failed_events(limit=50)
            print(f"Found {len(failed)} dead-letter event(s):")
            for ev in failed:
                err = sanitize_error_message(ev.error_message)
                print(
                    f"  - ID: {ev.id} | Type: {ev.event_type} | "
                    f"Attempts: {ev.attempt_count}/{ev.max_attempts} | Error: {err}"
                )
            return 0

    if args.retry_event:
        if not args.reason or not args.reason.strip():
            logger.error("--reason is strictly required when performing an admin retry")
            print("Error: --reason is required for admin retry")
            return 1
        try:
            event_id = uuid.UUID(args.retry_event)
        except ValueError:
            print(f"Error: Invalid event UUID '{args.retry_event}'")
            return 1
        with SessionLocal() as session:
            repo = OutboxRepository(session)
            success = repo.retry_event_admin(event_id, reason=args.reason)
            session.commit()
            if success:
                print(f"Successfully requeued outbox event {event_id} with reason: '{args.reason}'")
                return 0
            print(f"Outbox event {event_id} not found")
            return 1

    if args.list_notifications:
        with SessionLocal() as session:
            repo = NotificationRepository(session)
            notifs = repo.list_notifications(status=args.status, limit=50)
            status_desc = f" with status '{args.status}':" if args.status else ":"
            print(f"Found {len(notifs)} notification(s){status_desc}")
            for n in notifs:
                err = sanitize_error_message(n.error_message) if n.error_message else "None"
                print(
                    f"  - ID: {n.id} | Event: {n.event_id} | Kind: {n.kind} | "
                    f"Status: {n.status} | MsgID: {n.provider_message_id} | Err: {err}"
                )
            return 0

    if args.retry_notification:
        if not args.reason or not args.reason.strip():
            logger.error("--reason is strictly required when performing an admin retry")
            print("Error: --reason is required for admin retry")
            return 1
        try:
            notif_id = uuid.UUID(args.retry_notification)
        except ValueError:
            print(f"Error: Invalid notification UUID '{args.retry_notification}'")
            return 1
        with SessionLocal() as session:
            repo = NotificationRepository(session)
            success = repo.retry_notification_admin(notif_id, reason=args.reason)
            session.commit()
            if success:
                print(f"Successfully requeued notification {notif_id} with reason: '{args.reason}'")
                return 0
            print(f"Notification {notif_id} not found")
            return 1

    if args.check_sla:
        from datetime import UTC, datetime

        from app.sla.service import SlaEscalationService

        with SessionLocal() as session:
            try:
                checked, created = SlaEscalationService(session).check(now=datetime.now(UTC))
                session.commit()
                print(
                    f"SLA check completed: {checked} incident(s) checked, "
                    f"{created} escalation(s) created"
                )
                return 0
            except Exception as e:
                session.rollback()
                logger.exception("SLA check failed: %s", e)
                print(f"Error: SLA check failed: {e}")
                return 1

    # 2. Normal worker dispatch operations
    settings = OutboxSettings.from_env()
    if not settings.enabled:
        logger.warning("Outbox dispatching disabled via CIM_OUTBOX_DISPATCH_ENABLED")
        return 0

    worker = build_worker(settings)

    try:
        if args.recover:
            recovered = worker.recover_interrupted_events()
            logger.info("Recovered %d interrupted event(s)", recovered)
            return 0

        if args.once:
            counts = worker.run_once()
            logger.info("Cycle finished: %s", counts)
            return 0 if counts["failed"] == 0 and counts["dead_lettered"] == 0 else 1

        worker.run_forever(
            poll_interval_seconds=settings.poll_interval_seconds,
            install_signal_handlers=True,
            max_cycles=args.cycles,
        )
        return 0
    except Exception:  # noqa: BLE001 - CLI must exit cleanly with a non-zero code
        logger.exception("Outbox dispatcher stopped because of an unrecoverable error")
        return 1


if __name__ == "__main__":
    sys.exit(main())
