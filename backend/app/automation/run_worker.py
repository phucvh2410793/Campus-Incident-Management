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

from app.automation.config import OutboxSettings
from app.automation.worker import OutboxWorkerStub
from app.db import SessionLocal

logger = logging.getLogger(__name__)


def build_worker(settings: OutboxSettings) -> OutboxWorkerStub:
    return OutboxWorkerStub.from_settings(session_factory=SessionLocal, settings=settings)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="CIM outbox dispatcher")
    parser.add_argument("--once", action="store_true", help="process one batch and exit")
    parser.add_argument(
        "--recover",
        action="store_true",
        help="re-queue events with expired leases and exit",
    )
    parser.add_argument("--cycles", type=int, default=None, help="stop after N poll cycles")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

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
