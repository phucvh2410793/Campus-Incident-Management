from datetime import UTC, datetime, timedelta
from typing import Literal

Priority = Literal["p1", "p2", "p3"]

ACKNOWLEDGEMENT_SLA = {
    "p1": timedelta(minutes=15),
    "p2": timedelta(hours=2),
    "p3": timedelta(hours=8),
}


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Datetime must include a timezone.")
    return value.astimezone(UTC)


def calculate_deadline(reported_at: datetime, priority: Priority) -> datetime:
    """Calculate the acknowledgement deadline from the report time."""
    reported_at_utc = _as_utc(reported_at)
    return reported_at_utc + ACKNOWLEDGEMENT_SLA[priority]


def should_escalate(
    reported_at: datetime,
    priority: Priority,
    now: datetime,
    acknowledged_at: datetime | None = None,
    resolved: bool = False,
    closed: bool = False,
) -> bool:
    """Return whether an incident is eligible for acknowledgement escalation."""
    now_utc = _as_utc(now)
    deadline = calculate_deadline(reported_at, priority)

    if resolved or closed:
        return False

    if acknowledged_at is not None and _as_utc(acknowledged_at) <= now_utc:
        return False

    return now_utc >= deadline
