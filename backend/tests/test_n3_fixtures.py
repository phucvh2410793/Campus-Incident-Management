import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.sla.clock import FakeClock

FIXTURE_PATH = Path(__file__).parents[2] / "docs" / "fixtures" / "n3_cases.json"


def load_n3_cases():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_fake_clock_can_advance():
    clock = FakeClock(datetime(2026, 11, 2, 9, 30, tzinfo=UTC))

    clock.set(datetime(2026, 11, 2, 9, 45, tzinfo=UTC))

    assert clock.now() == datetime(2026, 11, 2, 9, 45, tzinfo=UTC)


def test_fake_clock_rejects_naive_datetime():
    clock = FakeClock(datetime(2026, 11, 2, 9, 30, tzinfo=UTC))

    with pytest.raises(ValueError):
        clock.set(datetime(2026, 11, 2, 10, 0))


def test_classification_fixture_cases_are_complete():
    data = load_n3_cases()
    cases = data["classification_cases"]

    assert data["schema_version"] == 1
    assert data["rule_version"] == "demo-v1"
    assert [case["test_id"] for case in cases] == ["T01", "T02", "T03", "T04", "T05", "T06"]

    for case in cases:
        assert case["request"]["category"] in {"water_leak", "electrical_hazard", "phishing"}
        assert case["expected"]["rule_version"] == data["rule_version"]
        assert case["expected"]["reason"]
        assert case["expected"]["priority"] in {"p1", "p2", "p3", None}


def test_unknown_case_requires_manual_triage_without_priority():
    cases = load_n3_cases()["classification_cases"]
    case = next(item for item in cases if item["test_id"] == "T06")

    assert case["expected"]["triage_required"] is True
    assert case["expected"]["priority"] is None
    assert case["expected"]["severity"] is None
    assert case["request"]["answers"] == {"leak_amount": "unknown", "near_electricity": "unknown"}


def test_sla_fixtures_cover_t10_to_t12():
    cases = load_n3_cases()["sla_cases"]

    assert [case["test_id"] for case in cases] == ["T10", "T11", "T12"]
    assert cases[0]["expected_escalation"] is True
    assert cases[1]["expected_escalation"] is False
    assert cases[2]["interleavings"] == [
        {
            "commit_order": ["acknowledge", "sla_job"],
            "acknowledged_at_at_job": "2026-11-02T09:45:00Z",
            "expected_escalation_records": 0,
        },
        {
            "commit_order": ["sla_job", "acknowledge"],
            "acknowledged_at_at_job": None,
            "expected_escalation_records": 1,
        },
    ]
