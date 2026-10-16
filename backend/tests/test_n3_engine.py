import json
from pathlib import Path

from app.rules.engine import evaluate_incident

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "n3_cases.json"


def load_cases():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8-sig"))


def test_t01_to_t06_match_expected_rule_results():
    cases = load_cases()["classification_cases"]

    for case in cases:
        result = evaluate_incident(case["report_type"], case["input"])
        expected = case["expected"]

        assert result.rule_id == expected["rule_id"], case["test_id"]
        assert result.severity == expected["severity"], case["test_id"]
        assert result.priority == expected["priority"], case["test_id"]
        assert result.department == expected["department"], case["test_id"]
        assert result.triage_required == expected["triage_required"], case["test_id"]

        if "safety_flags" in expected:
            assert list(result.safety_flags) == expected["safety_flags"]


def test_rule_order_prioritizes_immediate_electrical_danger():
    result = evaluate_incident(
        "electrical_hazard",
        {"exposed_wire": "yes", "smoke_or_sparks": "yes"},
    )

    assert result.rule_id == "R01"
    assert result.priority == "P1"
    assert result.severity == "Critical"


def test_unknown_answers_do_not_fall_back_to_p3():
    result = evaluate_incident(
        "water_leak",
        {"leak_size": "unknown", "near_electricity": "unknown"},
    )

    assert result.triage_required is True
    assert result.priority is None
    assert result.severity is None
    assert result.rule_id is None


def test_conflicting_phishing_answer_does_not_get_low_priority():
    result = evaluate_incident(
        "phishing",
        {"interaction": "unknown"},
    )

    assert result.triage_required is True
    assert result.priority is None
    assert result.department == "Hàng đợi phân loại thủ công"
