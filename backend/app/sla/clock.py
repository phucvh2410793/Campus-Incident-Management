from datetime import UTC, datetime


def require_utc(value: datetime) -> datetime:
    """Reject naive datetimes and normalize aware datetimes to UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Datetime must include a timezone.")

    return value.astimezone(UTC)


class FakeClock:
    """A deterministic clock for SLA tests."""

    def __init__(self, now: datetime) -> None:
        self._now = require_utc(now)

    def now(self) -> datetime:
        return self._now

    def set(self, value: datetime) -> None:
        self._now = require_utc(value)
