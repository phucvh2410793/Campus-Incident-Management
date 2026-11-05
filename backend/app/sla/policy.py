
from datetime import UTC, datetime, timedelta
from typing import Literal

Priority = Literal["p1", "p2", "p3"]

ACKNOWLEDGEMENT_SLA = {
    "p1": timedelta(minutes=15),
    "p2": timedelta(hours=2),
    "p3": timedelta(hours=8),
}

# Separate review deadline for incidents requiring manual triage.
REVIEW_ALERT_SLA = timedelta(minutes=15)


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


def calculate_review_deadline(reported_at: datetime) -> datetime:
    """Calculate the manual-triage review deadline from the report time."""
    return _as_utc(reported_at) + REVIEW_ALERT_SLA


def should_alert_for_review(
    reported_at: datetime,
    now: datetime,
    triage_required: bool,
) -> bool:
    """Return whether a manual-triage review alert should be triggered."""
    if not triage_required:
        return False

    now_utc = _as_utc(now)
    deadline = calculate_review_deadline(reported_at)

    return now_utc >= deadline
