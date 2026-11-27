"""N4 W9: handover keeps the right permissions and leaks nothing.

An incident with an internal note and an attachment is transferred to
another handler/department through the real API on real PostgreSQL. After
the transfer the old handler/manager lose all access (404), the new
handler/manager see the internal note and the file, and the reporter still
sees only public timeline entries. Requires TEST_DATABASE_URL pointing at
campus_incident_test (see docs/development.md).
"""

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.auth.security import hash_password
from app.core.config import get_settings
from app.incidents.models import Incident
from app.models import Department, User
from app.rules.engine import evaluate_incident

PASSWORD = "w9-transfer-visibility-pass"

PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF"
INTERNAL_BODY = "INTERNAL-ONLY-NOTE-7f3a"
PUBLIC_BODY = "We are looking into it"
TRANSFER_REASON = "Transfer to electrical team"

WATER_LEAK_NEAR_POWER = {
    "category": "water_leak",
    "title": "Leak near classroom 205",
    "description": "Water is dripping from the ceiling onto the hallway floor.",
    "building": "Building A",
    "location_detail": "Floor 2",
    "answers": {"leak_amount": "small", "near_electricity": "yes", "slip_risk": True},
}


@pytest.fixture
def case(client, db_session, tmp_path, monkeypatch):
    """Seed departments and users; store attachments in a temp dir."""
    monkeypatch.setattr(get_settings(), "evidence_dir", tmp_path)
    facilities = Department(id=uuid4(), name="Cơ sở vật chất")
    electrical = Department(id=uuid4(), name="Điện và an toàn")
    db_session.add_all([facilities, electrical])
    db_session.flush()

    users = {}
    headers = {}
    for label, role, department in (
        ("reporter", "reporter", None),
        ("handler_a", "handler", facilities),
        ("manager_a", "department_manager", facilities),
        ("handler_b", "handler", electrical),
        ("manager_b", "department_manager", electrical),
        ("admin", "administrator", None),
    ):
        user = User(
            id=uuid4(),
            email=f"w9-{label}-{uuid4().hex}@example.com",
            display_name=label,
            password_hash=hash_password(PASSWORD),
            role=role,
            department_id=department.id if department else None,
            is_active=True,
        )
        db_session.add(user)
        db_session.flush()
        login = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert login.status_code == 200, login.text
        users[label] = user
        headers[label] = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return SimpleNamespace(
        db=db_session,
        facilities=facilities,
        electrical=electrical,
        users=users,
        headers=headers,
    )


def create_incident(client, headers):
    response = client.post(
        "/api/v1/incidents",
        json=WATER_LEAK_NEAR_POWER,
        headers={**headers, "Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    return response.json()


def apply_rule(case, incident_id):
    """Stand-in for N3's create/triage integration (their W8 branch)."""
    incident = case.db.get(Incident, incident_id)
    result = evaluate_incident(incident.category, incident.answers)
    department = case.db.scalar(select(Department).where(Department.name == result.department))
    assert department is not None, result
    incident.department_id = department.id
    incident.priority = result.priority
    incident.severity = result.severity
    incident.rule_evaluation = result.model_dump(mode="json")
    incident.triage_required = False
    case.db.commit()
    return result


def prepare_transferred_incident(client, case):
    """Create, triage, assign, attach, comment, then transfer. Returns ids."""
    created = create_incident(client, case.headers["reporter"])
    incident_id = UUID(created["id"])
    apply_rule(case, incident_id)

    assigned = client.post(
        f"/api/v1/incidents/{incident_id}/assign",
        json={
            "department_id": str(case.facilities.id),
            "handler_id": str(case.users["handler_a"].id),
            "reason": "Assign to facilities handler",
            "expected_version": 1,
        },
        headers=case.headers["manager_a"],
    )
    assert assigned.status_code == 200, assigned.text

    uploaded = client.post(
        f"/api/v1/incidents/{incident_id}/attachments",
        files={"file": ("leak.pdf", PDF, "application/pdf")},
        data={"expected_version": "2"},
        headers=case.headers["handler_a"],
    )
    assert uploaded.status_code == 201, uploaded.text
    assert uploaded.json()["original_name"] == "leak.pdf"
    assert uploaded.json()["incident_version"] == 3
    attachment_id = UUID(uploaded.json()["id"])

    internal = client.post(
        f"/api/v1/incidents/{incident_id}/comments",
        json={"body": INTERNAL_BODY, "visibility": "internal", "expected_version": 3},
        headers=case.headers["handler_a"],
    )
    assert internal.status_code == 201, internal.text

    public = client.post(
        f"/api/v1/incidents/{incident_id}/comments",
        json={"body": PUBLIC_BODY, "visibility": "public", "expected_version": 4},
        headers=case.headers["handler_a"],
    )
    assert public.status_code == 201, public.text

    transferred = client.post(
        f"/api/v1/incidents/{incident_id}/assign",
        json={
            "department_id": str(case.electrical.id),
            "handler_id": str(case.users["handler_b"].id),
            "reason": TRANSFER_REASON,
            "expected_version": 5,
        },
        headers=case.headers["manager_a"],
    )
    assert transferred.status_code == 200, transferred.text
    body = transferred.json()["incident"]
    assert body["status"] == "assigned"
    assert body["version"] == 6
    assert body["department_id"] == str(case.electrical.id)
    assert body["assigned_handler_id"] == str(case.users["handler_b"].id)
    return incident_id, attachment_id


def test_old_staff_lose_access_after_transfer(client, case):
    incident_id, attachment_id = prepare_transferred_incident(client, case)

    for label in ("handler_a", "manager_a"):
        headers = case.headers[label]
        incident = client.get(f"/api/v1/incidents/{incident_id}", headers=headers)
        assert incident.status_code == 404
        assert incident.json()["error"]["code"] == "not_found"
        comments = client.get(f"/api/v1/incidents/{incident_id}/comments", headers=headers)
        assert comments.status_code == 404
        attachments = client.get(f"/api/v1/incidents/{incident_id}/attachments", headers=headers)
        assert attachments.status_code == 404
        history = client.get(f"/api/v1/incidents/{incident_id}/history", headers=headers)
        assert history.status_code == 404
        download = client.get(
            f"/api/v1/incidents/{incident_id}/attachments/{attachment_id}/download",
            headers=headers,
        )
        assert download.status_code == 404

    # The old manager can no longer assign either: out of scope, not forbidden.
    reassign = client.post(
        f"/api/v1/incidents/{incident_id}/assign",
        json={
            "department_id": str(case.facilities.id),
            "handler_id": str(case.users["handler_a"].id),
            "reason": "Old manager tries to take it back",
            "expected_version": 6,
        },
        headers=case.headers["manager_a"],
    )
    assert reassign.status_code == 404
    assert reassign.json()["error"]["code"] == "not_found"


def test_new_staff_gain_full_access_after_transfer(client, case):
    incident_id, attachment_id = prepare_transferred_incident(client, case)

    incident = client.get(f"/api/v1/incidents/{incident_id}", headers=case.headers["handler_b"])
    assert incident.status_code == 200, incident.text
    assert incident.json()["department_id"] == str(case.electrical.id)
    assert incident.json()["assigned_handler_id"] == str(case.users["handler_b"].id)

    comments = client.get(
        f"/api/v1/incidents/{incident_id}/comments", headers=case.headers["handler_b"]
    )
    assert comments.status_code == 200, comments.text
    seen = {item["visibility"]: item["body"] for item in comments.json()["items"]}
    assert seen == {"internal": INTERNAL_BODY, "public": PUBLIC_BODY}

    attachments = client.get(
        f"/api/v1/incidents/{incident_id}/attachments", headers=case.headers["handler_b"]
    )
    assert attachments.status_code == 200, attachments.text
    items = attachments.json()["items"]
    assert len(items) == 1 and items[0]["original_name"] == "leak.pdf"

    download = client.get(
        f"/api/v1/incidents/{incident_id}/attachments/{attachment_id}/download",
        headers=case.headers["handler_b"],
    )
    assert download.status_code == 200, download.text
    assert download.content == PDF

    history = client.get(
        f"/api/v1/incidents/{incident_id}/history", headers=case.headers["handler_b"]
    )
    assert history.status_code == 200, history.text
    items = history.json()["items"]
    internal = [
        item
        for item in items
        if item["action"] == "incident.commented" and item["visibility"] == "internal"
    ]
    assert len(internal) == 1
    assert internal[0]["details"]["body"] == INTERNAL_BODY
    assigned_events = [item for item in items if item["action"] == "incident.assigned"]
    assert len(assigned_events) == 2
    assert assigned_events[0]["details"]["department_id"] == str(case.electrical.id)
    assert assigned_events[0]["details"]["handler_id"] == str(case.users["handler_b"].id)

    # The new handler can operate; the new manager can assign.
    acknowledged = client.post(
        f"/api/v1/incidents/{incident_id}/acknowledge",
        json={"expected_version": 6},
        headers=case.headers["handler_b"],
    )
    assert acknowledged.status_code == 200, acknowledged.text
    assert acknowledged.json()["incident"]["status"] == "in_progress"


def test_reporter_timeline_hides_internal_data_after_transfer(client, case):
    incident_id, attachment_id = prepare_transferred_incident(client, case)

    incident = client.get(f"/api/v1/incidents/{incident_id}", headers=case.headers["reporter"])
    assert incident.status_code == 200, incident.text

    comments = client.get(
        f"/api/v1/incidents/{incident_id}/comments", headers=case.headers["reporter"]
    )
    assert comments.status_code == 200, comments.text
    seen = [item["visibility"] for item in comments.json()["items"]]
    assert seen == ["public"]

    history = client.get(
        f"/api/v1/incidents/{incident_id}/history", headers=case.headers["reporter"]
    )
    assert history.status_code == 200, history.text
    items = history.json()["items"]
    assert all(item["visibility"] == "public" for item in items)
    assert INTERNAL_BODY not in history.text
    assert TRANSFER_REASON not in history.text
    assert not any("reason" in item["details"] or "handler_id" in item["details"] for item in items)
    assigned_events = [item for item in items if item["action"] == "incident.assigned"]
    assert len(assigned_events) == 2
    assert all(item["details"] == {} for item in assigned_events)

    # The reporter still sees the incident's own attachments: they own it.
    attachments = client.get(
        f"/api/v1/incidents/{incident_id}/attachments", headers=case.headers["reporter"]
    )
    assert attachments.status_code == 200, attachments.text
    assert len(attachments.json()["items"]) == 1
    download = client.get(
        f"/api/v1/incidents/{incident_id}/attachments/{attachment_id}/download",
        headers=case.headers["reporter"],
    )
    assert download.status_code == 200, download.text
    assert download.content == PDF
