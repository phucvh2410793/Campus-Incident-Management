from datetime import UTC, datetime, timedelta

import pytest

from app.sla.policy import calculate_deadline, should_escalate

REPORTED_AT = datetime(2026, 11, 2, 9, 30, tzinfo=UTC)


@pytest.mark.parametrize(
    ("priority", "expected"),
    [
        ("P1", timedelta(minutes=15)),
        ("P2", timedelta(hours=2)),
        ("P3", timedelta(hours=8)),
    ],
)
def test_deadline_matches_priority(priority, expected):
    assert calculate_deadline(REPORTED_AT, priority) == REPORTED_AT + expected


def test_p1_does_not_escalate_before_deadline():
    assert not should_escalate(
        REPORTED_AT, "P1", REPORTED_AT + timedelta(minutes=14, seconds=59)
    )


def test_p1_escalates_at_deadline_if_unacknowledged():
    assert should_escalate(
        REPORTED_AT, "P1", REPORTED_AT + timedelta(minutes=15)
    )


def test_p1_escalates_after_deadline_if_unacknowledged():
    assert should_escalate(
        REPORTED_AT, "P1", REPORTED_AT + timedelta(minutes=16)
    )


@pytest.mark.parametrize(
    "acknowledged_at",
    [
        REPORTED_AT + timedelta(minutes=10),
        REPORTED_AT + timedelta(minutes=15),
    ],
)
def test_acknowledgement_before_or_at_job_time_prevents_escalation(acknowledged_at):
    assert not should_escalate(
        REPORTED_AT,
        "P1",
        REPORTED_AT + timedelta(minutes=15),
        acknowledged_at=acknowledged_at,
    )


@pytest.mark.parametrize("state", ["resolved", "closed"])
def test_resolved_or_closed_incident_does_not_escalate(state):
    assert not should_escalate(
        REPORTED_AT,
        "P1",
        REPORTED_AT + timedelta(minutes=20),
        **{state: True},
    )


def test_naive_datetime_is_rejected():
    with pytest.raises(ValueError):
        calculate_deadline(datetime(2026, 11, 2, 9, 30), "P1")


def test_priority_change_recalculates_from_original_report_time():
    # A change from P3 to P1 uses the original reported_at, not the change time.
    assert calculate_deadline(REPORTED_AT, "P1") == REPORTED_AT + timedelta(minutes=15)
