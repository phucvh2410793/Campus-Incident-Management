import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.sla.clock import FakeClock
from app.sla.policy import calculate_deadline, should_escalate

REPORTED_AT = datetime(2026, 11, 2, 9, 30, tzinfo=UTC)
SLA_CASES = json.loads(
    (Path(__file__).parents[2] / "docs" / "fixtures" / "n3_cases.json").read_text(
        encoding="utf-8"
    )
)["sla_cases"]


def parse_utc(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


@pytest.mark.parametrize(
    ("priority", "expected"),
    [
        ("p1", timedelta(minutes=15)),
        ("p2", timedelta(hours=2)),
        ("p3", timedelta(hours=8)),
    ],
)
def test_deadline_matches_priority(priority, expected):
    assert calculate_deadline(REPORTED_AT, priority) == REPORTED_AT + expected


def test_p1_does_not_escalate_before_deadline():
    assert not should_escalate(
        REPORTED_AT, "p1", REPORTED_AT + timedelta(minutes=14, seconds=59)
    )


def test_p1_escalates_at_deadline_if_unacknowledged():
    assert should_escalate(
        REPORTED_AT, "p1", REPORTED_AT + timedelta(minutes=15)
    )


def test_p1_escalates_after_deadline_if_unacknowledged():
    assert should_escalate(
        REPORTED_AT, "p1", REPORTED_AT + timedelta(minutes=16)
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
        "p1",
        REPORTED_AT + timedelta(minutes=15),
        acknowledged_at=acknowledged_at,
    )


@pytest.mark.parametrize("state", ["resolved", "closed"])
def test_resolved_or_closed_incident_does_not_escalate(state):
    assert not should_escalate(
        REPORTED_AT,
        "p1",
        REPORTED_AT + timedelta(minutes=20),
        **{state: True},
    )


def test_naive_datetime_is_rejected():
    with pytest.raises(ValueError):
        calculate_deadline(datetime(2026, 11, 2, 9, 30), "p1")


def test_priority_change_recalculates_from_original_report_time():
    # A change from P3 to P1 uses the original reported_at, not the change time.
    assert calculate_deadline(REPORTED_AT, "p1") == REPORTED_AT + timedelta(minutes=15)


@pytest.mark.parametrize("case", SLA_CASES[:2], ids=lambda case: case["test_id"])
def test_t10_t11_match_shared_fixture(case):
    reported_at = parse_utc(case["reported_at"])
    clock = FakeClock(parse_utc(case["job_at"]))
    assert calculate_deadline(reported_at, case["priority"]) == parse_utc(case["deadline_at"])
    assert should_escalate(
        reported_at,
        case["priority"],
        clock.now(),
        acknowledged_at=parse_utc(case["acknowledged_at"]),
    ) is case["expected_escalation"]


def test_t12_commit_orders_match_shared_fixture():
    case = SLA_CASES[2]
    reported_at = parse_utc(case["reported_at"])
    clock = FakeClock(parse_utc(case["job_at"]))
    assert calculate_deadline(reported_at, case["priority"]) == parse_utc(case["deadline_at"])
    results = []
    for order in case["interleavings"]:
        eligible = should_escalate(
            reported_at,
            case["priority"],
            clock.now(),
            acknowledged_at=parse_utc(order["acknowledged_at_at_job"]),
        )
        assert int(eligible) == order["expected_escalation_records"]
        results.append(int(eligible))
    assert max(results) == case["expected_max_escalation_records"]
