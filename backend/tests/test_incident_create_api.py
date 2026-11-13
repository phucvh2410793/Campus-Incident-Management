from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.automation.models import OutboxEvent
from app.automation.publisher import OutboxEventPublisher
from app.incidents.models import IdempotencyRecord, Incident

WATER_LEAK = {
    "category": "water_leak",
    "title": "Leak near classroom 205",
    "description": "Water is dripping from the ceiling onto the hallway floor.",
    "building": "Building A",
    "location_detail": "Floor 2",
    "answers": {"leak_amount": "small", "near_electricity": "no", "slip_risk": True},
}


def test_create_replay_and_conflict(client, auth_headers, db_session, test_user):
    key = str(uuid4())
    headers = {**auth_headers, "Idempotency-Key": key}
    first = client.post("/api/v1/incidents", json=WATER_LEAK, headers=headers)
    assert first.status_code == 201, first.text
    result = first.json()
    assert first.headers["Location"] == f"/api/v1/incidents/{result['id']}"
    assert result["reporter_id"] == str(test_user.id)
    assert result["status"] == "reported"
    assert result["version"] == 1
    assert result["priority"] is None
    assert result["department_id"] is None

    replay = client.post("/api/v1/incidents", json=WATER_LEAK, headers=headers)
    assert replay.status_code == 200
    assert replay.json() == result
    changed = client.post(
        "/api/v1/incidents", json={**WATER_LEAK, "title": "Different leak"}, headers=headers
    )
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "idempotency_conflict"
    assert db_session.scalar(select(func.count()).select_from(Incident)) == 1
    assert db_session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1
    events = db_session.scalars(select(OutboxEvent)).all()
    assert len(events) == 1
    assert events[0].event_type == "incident.reported"
    assert events[0].incident_id == UUID(result["id"])
    assert "description" not in events[0].payload


def test_create_rejects_missing_auth_key_and_invalid_body(client, auth_headers, db_session):
    assert client.post("/api/v1/incidents", json=WATER_LEAK).status_code == 401
    assert (
        client.post("/api/v1/incidents", json=WATER_LEAK, headers=auth_headers).status_code == 400
    )
    headers = {**auth_headers, "Idempotency-Key": str(uuid4())}
    assert (
        client.post(
            "/api/v1/incidents", json={**WATER_LEAK, "reporter_id": str(uuid4())}, headers=headers
        ).status_code
        == 422
    )
    assert db_session.scalar(select(func.count()).select_from(Incident)) == 0


def test_event_failure_rolls_back_all_records(
    client, auth_headers, db_session, monkeypatch: pytest.MonkeyPatch
):
    def fail_publish(self, *args, **kwargs):
        raise RuntimeError("outbox unavailable")

    monkeypatch.setattr(OutboxEventPublisher, "create_and_publish", fail_publish)
    with pytest.raises(RuntimeError, match="outbox unavailable"):
        client.post(
            "/api/v1/incidents",
            json=WATER_LEAK,
            headers={**auth_headers, "Idempotency-Key": str(uuid4())},
        )
    assert db_session.scalar(select(func.count()).select_from(Incident)) == 0
    assert db_session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0
    assert db_session.scalar(select(func.count()).select_from(OutboxEvent)) == 0


def test_expired_key_can_create_another_incident(client, auth_headers, db_session, test_user):
    key = uuid4()
    headers = {**auth_headers, "Idempotency-Key": str(key)}
    first = client.post("/api/v1/incidents", json=WATER_LEAK, headers=headers)
    assert first.status_code == 201
    record = db_session.get(IdempotencyRecord, (test_user.id, key))
    record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db_session.commit()

    second = client.post(
        "/api/v1/incidents", json={**WATER_LEAK, "title": "Another leak"}, headers=headers
    )
    assert second.status_code == 201, second.text
    assert second.json()["id"] != first.json()["id"]
    assert db_session.scalar(select(func.count()).select_from(Incident)) == 2
    assert db_session.scalar(select(func.count()).select_from(OutboxEvent)) == 2
    assert db_session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 1


@pytest.mark.parametrize(
    ("category", "answers"),
    [
        ("water_leak", WATER_LEAK["answers"]),
        ("electrical_hazard", {"exposed_wire": "yes", "smoke_or_sparks": "no"}),
        ("phishing", {"interaction": "none", "channel": "email"}),
    ],
)
def test_all_mvp_categories_create_with_pending_event(
    client, auth_headers, db_session, category, answers
):
    response = client.post(
        "/api/v1/incidents",
        json={**WATER_LEAK, "category": category, "answers": answers},
        headers={**auth_headers, "Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    assert response.json()["category"] == category
    assert all(response.json()["answers"][field] == value for field, value in answers.items())
    event = db_session.scalar(select(OutboxEvent))
    assert event is not None and event.status == "pending"
