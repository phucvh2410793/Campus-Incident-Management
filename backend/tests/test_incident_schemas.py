import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.incidents.schemas import (
    ElectricalHazardIncidentCreate,
    PhishingIncidentCreate,
    WaterLeakIncidentCreate,
    validate_incident_create,
)

FIXTURES = json.loads(
    (Path(__file__).parents[2] / "docs" / "fixtures" / "incidents.json").read_text(encoding="utf-8")
)["fixtures"]


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda fixture: fixture["fixture_id"])
def test_shared_incident_fixtures_match_request_schemas(fixture):
    result = validate_incident_create(fixture["request"])
    assert result.category == fixture["request"]["category"]


@pytest.mark.parametrize(
    "schema,payload",
    [
        (
            WaterLeakIncidentCreate,
            {
                "category": "water_leak",
                "title": "Water leak",
                "description": "Water is leaking onto the floor.",
                "building": "A",
                "answers": {"leak_amount": "unknown", "near_electricity": "unknown"},
            },
        ),
        (
            ElectricalHazardIncidentCreate,
            {
                "category": "electrical_hazard",
                "title": "Electrical hazard",
                "description": "Smoke is visible near the electrical panel.",
                "building": "B",
                "answers": {"exposed_wire": "unknown", "smoke_or_sparks": "unknown"},
            },
        ),
        (
            PhishingIncidentCreate,
            {
                "category": "phishing",
                "title": "Suspicious email",
                "description": "I received a suspicious message and did not interact with it.",
                "building": "Library",
                "answers": {"interaction": "unknown", "channel": "email"},
            },
        ),
    ],
)
def test_unknown_answer_value_is_valid(schema, payload):
    schema.model_validate(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {**FIXTURES[0]["request"], "reporter_id": "10000000-0000-4000-8000-000000000001"},
        {**FIXTURES[0]["request"], "status": "reported"},
        {**FIXTURES[0]["request"], "priority": "p1"},
        {
            **FIXTURES[0]["request"],
            "answers": {**FIXTURES[0]["request"]["answers"], "private_note": "extra"},
        },
    ],
)
def test_unknown_fields_and_server_owned_values_are_rejected(payload):
    with pytest.raises(ValidationError):
        validate_incident_create(payload)


@pytest.mark.parametrize(
    "field,value",
    [
        ("title", "tiny"),
        ("title", "t" * 121),
        ("description", "too short"),
        ("description", "d" * 2001),
        ("building", ""),
        ("building", "b" * 121),
        ("location_detail", "l" * 201),
        ("title", 12345),
    ],
)
def test_invalid_common_fields_are_rejected(field, value):
    payload = dict(FIXTURES[0]["request"])
    payload[field] = value
    with pytest.raises(ValidationError):
        validate_incident_create(payload)


@pytest.mark.parametrize(
    "category,answers",
    [
        ("water_leak", {"leak_amount": "medium", "near_electricity": "no"}),
        ("water_leak", {"leak_amount": "small"}),
        ("water_leak", {"leak_amount": "small", "near_electricity": "no", "slip_risk": "false"}),
        ("electrical_hazard", {"exposed_wire": "yes"}),
        ("electrical_hazard", {"exposed_wire": "maybe", "smoke_or_sparks": "no"}),
        (
            "electrical_hazard",
            {"exposed_wire": "yes", "smoke_or_sparks": "no", "equipment": "e" * 201},
        ),
        ("phishing", {"interaction": "none"}),
        ("phishing", {"interaction": "clicked", "channel": "email"}),
        ("phishing", {"interaction": "none", "channel": "email", "sender_text": "s" * 255}),
    ],
)
def test_invalid_answers_are_rejected_for_each_category(category, answers):
    request = next(
        fixture["request"] for fixture in FIXTURES if fixture["request"]["category"] == category
    )
    with pytest.raises(ValidationError):
        validate_incident_create({**request, "answers": answers})


@pytest.mark.parametrize("observed_at", ["2026-10-11T02:15:00+07:00", "not-a-dateZ"])
def test_invalid_observed_at_is_rejected(observed_at):
    with pytest.raises(ValidationError):
        validate_incident_create({**FIXTURES[0]["request"], "observed_at": observed_at})


def test_future_observed_at_is_rejected():
    future = (datetime.now(UTC) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    with pytest.raises(ValidationError):
        validate_incident_create({**FIXTURES[0]["request"], "observed_at": future})


@pytest.mark.parametrize(
    "category,answers",
    [
        ("water_leak", {"leak_amount": "small", "near_electricity": "no", "slip_risk": None}),
        ("electrical_hazard", {"exposed_wire": "yes", "smoke_or_sparks": "no", "equipment": None}),
        ("phishing", {"interaction": "none", "channel": "email", "sender_text": None}),
    ],
)
def test_optional_answers_accept_null(category, answers):
    request = next(
        fixture["request"] for fixture in FIXTURES if fixture["request"]["category"] == category
    )
    validate_incident_create({**request, "answers": answers})
