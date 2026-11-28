"""N2 integration checks for offline automation, scope, and concurrent updates."""

import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
import sqlalchemy as sa
from fastapi import Request, Response
from sqlalchemy.orm import sessionmaker
from test_incident_create_api import WATER_LEAK
from test_incident_read_api import make_user

from app.auth.policy import Principal
from app.automation.models import OutboxEvent
from app.core.config import get_settings
from app.evidence.inventory import build_inventory
from app.evidence.models import IncidentAttachment
from app.incidents.models import Incident
from app.incidents.supplements import IncidentSupplement
from app.incidents.updates import SupplementRequest, add_supplement
from app.models import User
from app.workflow.contracts import WorkflowViolation
from app.workflow.models import AuditLog


def test_create_survives_offline_automation_and_keeps_event(client, auth_headers, db_session):
    """Creating a report must not depend on a live n8n webhook or worker."""
    key = str(uuid4())
    headers = {**auth_headers, "Idempotency-Key": key}
    created = client.post("/api/v1/incidents", json=WATER_LEAK, headers=headers)
    assert created.status_code == 201, created.text
    event = db_session.scalar(sa.select(OutboxEvent))
    assert event is not None
    assert event.status == "pending"
    assert str(event.incident_id) == created.json()["id"]

    replay = client.post("/api/v1/incidents", json=WATER_LEAK, headers=headers)
    assert replay.status_code == 200
    assert replay.json()["id"] == created.json()["id"]
    assert db_session.scalar(sa.select(sa.func.count()).select_from(OutboxEvent)) == 1


def test_reporter_scope_and_script_text_stay_json(client, db_session, auth_headers):
    _, other_headers = make_user(client, db_session, "reporter")
    _, admin_headers = make_user(client, db_session, "administrator")
    script = '<script>alert("x")</script>'
    response = client.post(
        "/api/v1/incidents",
        json={**WATER_LEAK, "description": f"A test description: {script}"},
        headers={**auth_headers, "Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    incident_id = response.json()["id"]
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["description"].endswith(script)

    paths = (
        f"/api/v1/incidents/{incident_id}",
        f"/api/v1/incidents/{incident_id}/history",
        f"/api/v1/incidents/{incident_id}/attachments",
    )
    for path in paths:
        assert client.get(path, headers=other_headers).status_code == 404
        assert client.get(path, headers=admin_headers).status_code == 200


def test_evidence_inventory_catches_missing_or_changed_files(
    client, db_session, auth_headers, tmp_path, monkeypatch
):
    monkeypatch.setattr(get_settings(), "evidence_dir", tmp_path)
    created = client.post(
        "/api/v1/incidents",
        json=WATER_LEAK,
        headers={**auth_headers, "Idempotency-Key": str(uuid4())},
    )
    incident_id = created.json()["id"]
    upload = client.post(
        f"/api/v1/incidents/{incident_id}/attachments",
        data={"expected_version": "1"},
        files={"file": ("report.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")},
        headers=auth_headers,
    )
    assert upload.status_code == 201, upload.text
    inventory = build_inventory(db_session, tmp_path)
    assert len(inventory["attachments"]) == 1
    record = db_session.scalar(sa.select(IncidentAttachment))
    path = tmp_path / record.storage_key

    path.write_bytes(b"%PDF-1.4\n%%EOX")
    assert build_inventory(db_session, tmp_path) != inventory
    path.write_bytes(b"changed")
    with pytest.raises(ValueError, match="size differs"):
        build_inventory(db_session, tmp_path)
    path.unlink()
    with pytest.raises(ValueError, match="Missing evidence"):
        build_inventory(db_session, tmp_path)
    assert (
        client.get(
            f"/api/v1/incidents/{incident_id}/attachments/{upload.json()['id']}/download",
            headers=auth_headers,
        ).status_code
        == 404
    )
    path.write_bytes(b"%PDF-1.4\n%%EOF")
    (tmp_path / "orphan").write_bytes(b"unused")
    with pytest.raises(ValueError, match="without database metadata"):
        build_inventory(db_session, tmp_path)


def test_two_supplements_with_one_version_cannot_both_commit(test_engine):
    factory = sessionmaker(bind=test_engine)
    user_id, incident_id = uuid4(), uuid4()
    with factory.begin() as db:
        db.add(
            User(
                id=user_id,
                email=f"n2-race-{user_id}@example.invalid",
                display_name="N2 race reporter",
                password_hash="test-only",
                role="reporter",
                is_active=True,
            )
        )
        db.flush()
        db.add(
            Incident(
                id=incident_id,
                reporter_id=user_id,
                category="water_leak",
                title="Concurrent supplement test",
                description="A water leak reported for concurrency testing.",
                building="Building A",
                answers=WATER_LEAK["answers"],
            )
        )

    barrier = threading.Barrier(2)
    principal = Principal(str(user_id), "reporter", None)

    def submit(number: int) -> str:
        with factory() as db:
            barrier.wait(timeout=10)
            try:
                result = add_supplement(
                    incident_id,
                    SupplementRequest(text=f"Update {number}", expected_version=1),
                    Request({"type": "http", "headers": []}),
                    Response(),
                    principal,
                    db,
                )
            except WorkflowViolation as exc:
                return exc.code
            assert result["incident_version"] == 2
            return "created"

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(submit, (1, 2)))
        assert sorted(outcomes) == ["created", "version_conflict"]
        with factory() as db:
            assert db.get(Incident, incident_id).version == 2
            assert (
                db.scalar(
                    sa.select(sa.func.count())
                    .select_from(IncidentSupplement)
                    .where(IncidentSupplement.incident_id == incident_id)
                )
                == 1
            )
    finally:
        with factory.begin() as db:
            db.execute(sa.delete(AuditLog).where(AuditLog.incident_id == incident_id))
            db.execute(
                sa.delete(IncidentSupplement).where(IncidentSupplement.incident_id == incident_id)
            )
            db.execute(sa.delete(Incident).where(Incident.id == incident_id))
            db.execute(sa.delete(User).where(User.id == user_id))
