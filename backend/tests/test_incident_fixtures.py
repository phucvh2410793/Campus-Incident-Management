import json
import uuid
from datetime import datetime
from pathlib import Path

from app.models import IdempotencyRecord, Incident, IncidentAttachment


def test_shared_incident_fixtures_match_contract():
    fixture_path = Path(__file__).parents[2] / "docs" / "fixtures" / "incidents.json"
    fixtures = json.loads(fixture_path.read_text(encoding="utf-8"))["fixtures"]

    assert {item["request"]["category"] for item in fixtures} == {
        "water_leak",
        "electrical_hazard",
        "phishing",
    }
    assert len({item["fixture_id"] for item in fixtures}) == 3
    assert len({item["idempotency_key"] for item in fixtures}) == 3

    answer_fields = {
        "water_leak": {"leak_amount", "near_electricity", "slip_risk"},
        "electrical_hazard": {"exposed_wire", "smoke_or_sparks", "equipment"},
        "phishing": {"interaction", "channel", "sender_text"},
    }
    allowed_values = {
        "leak_amount": {"small", "large", "unknown"},
        "near_electricity": {"yes", "no", "unknown"},
        "exposed_wire": {"yes", "no", "unknown"},
        "smoke_or_sparks": {"yes", "no", "unknown"},
        "interaction": {"none", "clicked_link", "entered_information", "unknown"},
        "channel": {"email", "message", "other"},
    }
    for item in fixtures:
        uuid.UUID(item["mock_incident_id"])
        uuid.UUID(item["idempotency_key"])
        request = item["request"]
        response = item["mock_response"]
        assert set(request) == {
            "category",
            "title",
            "description",
            "building",
            "location_detail",
            "observed_at",
            "answers",
        }
        assert set(request["answers"]) == answer_fields[request["category"]]
        for field, value in request["answers"].items():
            if field in allowed_values:
                assert value in allowed_values[field]
        if request["category"] == "water_leak":
            assert isinstance(request["answers"]["slip_risk"], bool)
        assert len(request["title"]) >= 5 and len(request["description"]) >= 20
        assert (
            datetime.fromisoformat(request["observed_at"].replace("Z", "+00:00"))
            .utcoffset()
            .total_seconds()
            == 0
        )
        assert set(response) == {
            "id",
            "version",
            "category",
            "title",
            "description",
            "building",
            "location_detail",
            "observed_at",
            "answers",
            "reporter_id",
            "status",
            "triage_required",
            "severity",
            "priority",
            "department_id",
            "assigned_handler_id",
            "rule_evaluation",
            "reported_at",
            "assigned_at",
            "acknowledged_at",
            "resolved_at",
            "closed_at",
            "acknowledgment_deadline_at",
            "escalation_level",
        }
        uuid.UUID(response["reporter_id"])
        assert response["id"] == item["mock_incident_id"]
        assert response["version"] == 1 and response["status"] == "reported"
        assert response["answers"] == request["answers"]
        assert response["category"] == request["category"]
        assert item["expected_evaluation"]["priority"] in {"p1", "p2", "p3"}
        assert item["expected_evaluation"]["severity"] in {"low", "medium", "high", "critical"}


def test_n2_models_expose_expected_tables_and_keys():
    assert set(Incident.__table__.columns.keys()) >= {
        "id",
        "reporter_id",
        "category",
        "answers",
        "status",
        "version",
        "reported_at",
    }
    assert set(IncidentAttachment.__table__.columns.keys()) >= {
        "id",
        "incident_id",
        "storage_key",
        "content_type",
        "size_bytes",
    }
    assert set(IdempotencyRecord.__table__.primary_key.columns.keys()) == {"user_id", "key"}
