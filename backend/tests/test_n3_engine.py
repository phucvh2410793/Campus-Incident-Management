import json
from pathlib import Path

from app.rules.engine import evaluate_incident

FIXTURE_PATH = Path(__file__).parents[2] / "docs" / "fixtures" / "n3_cases.json"


def load_cases():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_t01_to_t06_match_expected_rule_results():
    cases = load_cases()["classification_cases"]

    for case in cases:
        result = evaluate_incident(**case["request"])
        assert result.model_dump(mode="json") == case["expected"], case["test_id"]


def test_rule_order_prioritizes_immediate_electrical_danger():
    result = evaluate_incident(
        "electrical_hazard",
        {"exposed_wire": "yes", "smoke_or_sparks": "yes"},
    )

    assert result.rule_id == "R01"
    assert result.priority == "p1"
    assert result.severity == "critical"


def test_unknown_answers_do_not_fall_back_to_p3():
    result = evaluate_incident(
        "water_leak",
        {"leak_amount": "unknown", "near_electricity": "unknown"},
    )

    assert result.triage_required is True
    assert result.priority is None
    assert result.severity is None
    assert result.rule_id is None


def test_n2_water_leak_answers_with_optional_boolean_can_be_evaluated():
    result = evaluate_incident(
        "water_leak",
        {"leak_amount": "small", "near_electricity": "no", "slip_risk": True},
    )
    assert result.rule_id == "R07"
    assert result.priority == "p3"


def test_conflicting_phishing_answer_does_not_get_low_priority():
    result = evaluate_incident(
        "phishing",
        {"interaction": "unknown"},
    )

    assert result.triage_required is True
    assert result.priority is None
    assert result.department == "Hàng đợi phân loại thủ công"
