import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.sla.clock import FakeClock

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "n3_cases.json"


def load_n3_cases():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8-sig"))


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

    assert data["rule_version"] == "demo-v1"
    assert [case["test_id"] for case in cases] == [
        "T01", "T02", "T03", "T04", "T05", "T06"
    ]

    for case in cases:
        assert "report_type" in case
        assert "input" in case
        assert "expected" in case
        assert "triage_required" in case["expected"]


def test_unknown_case_requires_manual_triage_without_priority():
    cases = load_n3_cases()["classification_cases"]
    case = next(item for item in cases if item["test_id"] == "T06")

    assert case["expected"]["triage_required"] is True
    assert case["expected"]["priority"] is None
    assert case["expected"]["severity"] is None


def test_sla_fixtures_cover_t10_to_t12():
    cases = load_n3_cases()["sla_cases"]

    assert [case["test_id"] for case in cases] == ["T10", "T11", "T12"]
    assert cases[0]["expected_escalation"] is True
    assert cases[1]["expected_escalation"] is False
    assert cases[2]["expected_escalation"] is False
