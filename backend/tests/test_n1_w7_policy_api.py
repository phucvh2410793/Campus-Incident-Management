"""N1 W7 record-scope matrix through real incident, comment and workflow APIs."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.auth.security import hash_password
from app.comments.models import Comment
from app.incidents.models import Incident
from app.main import app
from app.models import Department, User
from app.workflow.models import AuditLog

PASSWORD = "W7-test-password-123!"
PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF"


def _has_route(suffix: str) -> bool:
    return f"/api/v1/incidents/{{incident_id}}/{suffix}" in app.openapi()["paths"]


@pytest.fixture
def case(client, db_session):
    first = Department(id=uuid4(), name=f"W7 first {uuid4().hex}")
    second = Department(id=uuid4(), name=f"W7 second {uuid4().hex}")
    db_session.add_all([first, second])
    db_session.flush()

    users = {}
    headers = {}
    for label, role, department in (
        ("owner", "reporter", None),
        ("outsider", "reporter", None),
        ("handler_first", "handler", first),
        ("handler_second", "handler", second),
        ("manager_first", "department_manager", first),
        ("manager_second", "department_manager", second),
        ("admin", "administrator", None),
    ):
        user = User(
            id=uuid4(),
            email=f"w7-{label}-{uuid4().hex}@example.com",
            display_name=label,
            password_hash=hash_password(PASSWORD),
            role=role,
            department_id=department.id if department else None,
            is_active=True,
        )
        db_session.add(user)
        db_session.flush()
        login = client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
        assert login.status_code == 200, login.text
        users[label] = user
        headers[label] = {"Authorization": f"Bearer {login.json()['access_token']}"}

    incident = Incident(
        id=uuid4(),
        reporter_id=users["owner"].id,
        category="water_leak",
        title="Water leak near lab",
        description="Water has reached the laboratory entrance.",
        building="Building A",
        answers={"leak_amount": "small", "near_electricity": "no"},
        department_id=first.id,
        assigned_handler_id=users["handler_first"].id,
        status="assigned",
    )
    db_session.add(incident)
    db_session.flush()
    now = datetime.now(UTC)
    db_session.add_all(
        [
            Comment(
                incident_id=incident.id,
                actor_id=users["handler_first"].id,
                body="Public update",
                visibility="public",
                created_at=now,
            ),
            Comment(
                incident_id=incident.id,
                actor_id=users["handler_first"].id,
                body="Internal note",
                visibility="internal",
                created_at=now + timedelta(seconds=1),
            ),
        ]
    )
    db_session.flush()
    db_session.commit()
    return client, db_session, first, second, users, headers, incident


def test_read_and_comment_api_hide_cross_ids_and_internal_notes(case):
    client, db, _, _, users, headers, incident = case
    detail_url = f"/api/v1/incidents/{incident.id}"
    comment_url = f"{detail_url}/comments"
    for label in ("owner", "handler_first", "manager_first", "admin"):
        assert client.get(detail_url, headers=headers[label]).status_code == 200
    for label in ("outsider", "handler_second", "manager_second"):
        detail = client.get(detail_url, headers=headers[label])
        comments = client.get(comment_url, headers=headers[label])
        assert detail.status_code == comments.status_code == 404, comments.text
        assert detail.json()["error"]["code"] == comments.json()["error"]["code"] == "not_found"

    owner_page = client.get(comment_url, headers=headers["owner"])
    assert owner_page.status_code == 200, owner_page.text
    assert [item["body"] for item in owner_page.json()["items"]] == ["Public update"]
    for label in ("handler_first", "manager_first", "admin"):
        page = client.get(comment_url, headers=headers[label])
        assert page.status_code == 200
        assert {item["body"] for item in page.json()["items"]} == {"Public update", "Internal note"}

    request = {"body": "<script>alert(1)</script>", "visibility": "internal", "expected_version": 1}
    denied = client.post(comment_url, json=request, headers=headers["owner"])
    hidden = client.post(comment_url, json=request, headers=headers["outsider"])
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "forbidden"
    assert hidden.status_code == 404 and hidden.json()["error"]["code"] == "not_found"
    assert db.get(Incident, incident.id).version == 1

    created = client.post(comment_url, json=request, headers=headers["handler_first"])
    assert created.status_code == 201, created.text
    assert created.json()["body"] == "&lt;script&gt;alert(1)&lt;/script&gt;"
    assert created.json()["incident_version"] == 2
    stale = client.post(comment_url, json=request, headers=headers["handler_first"])
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"
    assert db.scalar(select(AuditLog).where(AuditLog.action == "comment.created")) is not None

    first_page = client.get(comment_url, params={"limit": 1}, headers=headers["admin"])
    second_page = client.get(
        comment_url,
        params={"limit": 1, "cursor": first_page.json()["next_cursor"]},
        headers=headers["admin"],
    )
    assert first_page.status_code == second_page.status_code == 200
    assert first_page.json()["items"][0]["id"] != second_page.json()["items"][0]["id"]
    assert (
        client.get(comment_url, params={"cursor": "bad"}, headers=headers["owner"]).status_code
        == 422
    )


def test_transfer_recomputes_scope_and_workflow_errors(case):
    client, _, _, second, users, headers, incident = case
    detail_url = f"/api/v1/incidents/{incident.id}"
    assign_url = f"{detail_url}/assign"
    payload = {
        "department_id": str(second.id),
        "handler_id": str(users["handler_second"].id),
        "reason": "Move to the responsible department",
        "expected_version": 1,
    }
    owner = client.post(assign_url, json=payload, headers=headers["owner"])
    other_manager = client.post(assign_url, json=payload, headers=headers["manager_second"])
    assert owner.status_code == 403 and other_manager.status_code == 404
    moved = client.post(assign_url, json=payload, headers=headers["manager_first"])
    assert moved.status_code == 200, moved.text
    for label in ("handler_first", "manager_first"):
        assert client.get(detail_url, headers=headers[label]).status_code == 404
        assert client.get(f"{detail_url}/comments", headers=headers[label]).status_code == 404
    for label in ("owner", "handler_second", "manager_second", "admin"):
        assert client.get(detail_url, headers=headers[label]).status_code == 200
    assert len(client.get(f"{detail_url}/comments", headers=headers["owner"]).json()["items"]) == 1
    accepted = client.post(
        f"{detail_url}/acknowledge",
        json={"expected_version": 2},
        headers=headers["handler_second"],
    )
    assert accepted.status_code == 200 and accepted.json()["incident"]["status"] == "in_progress"


def test_staff_owner_sees_public_but_not_internal_without_assignment(case):
    client, db, first, _, users, headers, _ = case
    incident = Incident(
        id=uuid4(),
        reporter_id=users["handler_second"].id,
        category="water_leak",
        title="Water leak reported by staff",
        description="Water is pooling near a classroom entrance.",
        building="Building A",
        answers={"leak_amount": "small", "near_electricity": "no"},
        department_id=first.id,
        assigned_handler_id=users["handler_first"].id,
        status="assigned",
    )
    db.add(incident)
    db.flush()
    now = datetime.now(UTC)
    db.add_all(
        [
            Comment(
                incident_id=incident.id,
                actor_id=users["handler_first"].id,
                body="Public status",
                visibility="public",
                created_at=now,
            ),
            Comment(
                incident_id=incident.id,
                actor_id=users["handler_first"].id,
                body="Private assignment detail",
                visibility="internal",
                created_at=now + timedelta(seconds=1),
            ),
        ]
    )
    db.commit()
    url = f"/api/v1/incidents/{incident.id}/comments"
    page = client.get(url, headers=headers["handler_second"])
    assert page.status_code == 200, page.text
    assert [item["body"] for item in page.json()["items"]] == ["Public status"]
    denied = client.post(
        url,
        json={"body": "Private reply", "visibility": "internal", "expected_version": 1},
        headers=headers["handler_second"],
    )
    assert denied.status_code == 403


@pytest.mark.skipif(not _has_route("attachments"), reason="N2 evidence branch not merged")
def test_n2_evidence_uses_record_scope_and_matching_incident_id(case, tmp_path, monkeypatch):
    from app.core.config import get_settings

    client, db, first, _, users, headers, incident = case
    monkeypatch.setattr(get_settings(), "evidence_dir", tmp_path)
    base = f"/api/v1/incidents/{incident.id}/attachments"
    denied = client.post(
        base,
        data={"expected_version": "1"},
        files={"file": ("report.pdf", PDF, "application/pdf")},
        headers=headers["outsider"],
    )
    assert denied.status_code == 404 and denied.json()["error"]["code"] == "not_found"
    assert client.get(base, headers=headers["outsider"]).status_code == 404

    uploaded = client.post(
        base,
        data={"expected_version": "1"},
        files={"file": ("report.pdf", PDF, "application/pdf")},
        headers=headers["owner"],
    )
    assert uploaded.status_code == 201, uploaded.text
    attachment_id = uploaded.json()["id"]
    assert client.get(f"{base}/{attachment_id}/download", headers=headers["owner"]).content == PDF
    hidden_file = client.get(f"{base}/{attachment_id}/download", headers=headers["outsider"])
    assert hidden_file.status_code == 404

    other = Incident(
        id=uuid4(),
        reporter_id=users["owner"].id,
        category="water_leak",
        title="Another water leak",
        description="Water leaking by the library entrance.",
        building="Building A",
        answers={"leak_amount": "small", "near_electricity": "no"},
        department_id=first.id,
        status="reported",
    )
    db.add(other)
    db.commit()
    wrong_incident = client.get(
        f"/api/v1/incidents/{other.id}/attachments/{attachment_id}/download",
        headers=headers["owner"],
    )
    assert wrong_incident.status_code == 404
    assert wrong_incident.json()["error"]["code"] == "not_found"


@pytest.mark.skipif(not _has_route("supplements"), reason="N2 supplements branch not merged")
def test_n2_supplements_and_history_follow_record_scope(case):
    client, _, _, _, _, headers, incident = case
    base = f"/api/v1/incidents/{incident.id}"
    payload = {"text": "Water has spread into the corridor.", "expected_version": 1}
    hidden = client.post(f"{base}/supplements", json=payload, headers=headers["outsider"])
    assert hidden.status_code == 404
    assert client.get(f"{base}/history", headers=headers["outsider"]).status_code == 404
    denied = client.post(f"{base}/supplements", json=payload, headers=headers["handler_first"])
    assert denied.status_code == 403
    created = client.post(f"{base}/supplements", json=payload, headers=headers["owner"])
    assert created.status_code == 201, created.text
    assert client.get(f"{base}/history", headers=headers["owner"]).status_code == 200


@pytest.mark.skipif(not _has_route("transitions"), reason="N4 transitions branch not merged")
def test_n4_transition_denies_owner_and_unrelated_staff(case):
    client, _, _, _, _, headers, incident = case
    url = f"/api/v1/incidents/{incident.id}/transitions"
    payload = {"target_status": "resolved", "expected_version": 1, "resolution": "Pipe repaired"}
    owner = client.post(url, json=payload, headers=headers["owner"])
    outsider = client.post(url, json=payload, headers=headers["handler_second"])
    assert owner.status_code == 403 and owner.json()["error"]["code"] == "forbidden"
    assert outsider.status_code == 404 and outsider.json()["error"]["code"] == "not_found"
