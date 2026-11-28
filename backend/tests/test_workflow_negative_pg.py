"""N4 W10: negative lifecycle cases (test plan T07-T09) on real PostgreSQL.

Through the real API: a reporter cannot read, comment on or download
another reporter's incident (T07); other-department staff cannot operate
on an incident outside their department (T08); reporters and handlers
cannot close or reopen, and managers must give a reason to return or
reopen (T09). A final test sweeps the unlisted transition edges at every
state. Requires TEST_DATABASE_URL pointing at campus_incident_test (see
docs/development.md).
"""

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app.auth.security import hash_password
from app.models import Department, User

PASSWORD = "w10-lifecycle-negative-pass"

PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF"
INTERNAL_BODY = "INTERNAL-ONLY-NOTE-9c41"
PUBLIC_BODY = "We are looking into it"

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
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "evidence_dir", tmp_path)
    facilities = Department(id=uuid4(), name="Cơ sở vật chất")
    electrical = Department(id=uuid4(), name="Điện và an toàn")
    db_session.add_all([facilities, electrical])
    db_session.flush()

    users = {}
    headers = {}
    for label, role, department in (
        ("reporter_a", "reporter", None),
        ("reporter_b", "reporter", None),
        ("handler_a", "handler", facilities),
        ("manager_a", "department_manager", facilities),
        ("handler_b", "handler", electrical),
        ("manager_b", "department_manager", electrical),
    ):
        user = User(
            id=uuid4(),
            email=f"w10-{label}-{uuid4().hex}@example.com",
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


def get_incident(client, headers, incident_id):
    response = client.get(f"/api/v1/incidents/{incident_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def prepare_rich_incident(client, case):
    """Create, assign, attach and comment. Returns ids; version is 5."""
    created = create_incident(client, case.headers["reporter_a"])
    incident_id = UUID(created["id"])
    assert created["department_id"] == str(case.facilities.id)
    assert created["priority"] == "p1"

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
    return incident_id, attachment_id


def drive_to_resolved(client, case):
    """Create, assign, acknowledge, resolve. Returns id; version is 4."""
    created = create_incident(client, case.headers["reporter_a"])
    incident_id = UUID(created["id"])

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

    acknowledged = client.post(
        f"/api/v1/incidents/{incident_id}/acknowledge",
        json={"expected_version": 2},
        headers=case.headers["handler_a"],
    )
    assert acknowledged.status_code == 200, acknowledged.text

    resolved = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={
            "target_status": "resolved",
            "resolution": "Fixed the leak and dried the floor",
            "expected_version": 3,
        },
        headers=case.headers["handler_a"],
    )
    assert resolved.status_code == 200, resolved.text
    return incident_id


def test_reporter_cannot_access_another_reporters_incident(client, case):
    """T07: swapping the id must not leak the other reporter's data."""
    incident_id, attachment_id = prepare_rich_incident(client, case)
    headers = case.headers["reporter_b"]

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

    comment = client.post(
        f"/api/v1/incidents/{incident_id}/comments",
        json={"body": "Trying to comment", "visibility": "public", "expected_version": 5},
        headers=headers,
    )
    assert comment.status_code == 404

    upload = client.post(
        f"/api/v1/incidents/{incident_id}/attachments",
        files={"file": ("sneaky.pdf", PDF, "application/pdf")},
        data={"expected_version": "5"},
        headers=headers,
    )
    assert upload.status_code == 404

    # Nothing of the other reporter's incident leaks in any response.
    for response in (incident, comments, attachments, history, download, comment, upload):
        assert "Leak near classroom 205" not in response.text
        assert INTERNAL_BODY not in response.text
        assert PUBLIC_BODY not in response.text
        assert "leak.pdf" not in response.text

    # The incident itself is untouched.
    own = get_incident(client, case.headers["reporter_a"], incident_id)
    assert own["version"] == 5


def test_other_department_staff_cannot_operate(client, case):
    """T08: out-of-department staff get 404, not 403, on every action."""
    incident_id, attachment_id = prepare_rich_incident(client, case)

    handler_b = case.headers["handler_b"]
    acknowledge = client.post(
        f"/api/v1/incidents/{incident_id}/acknowledge",
        json={"expected_version": 5},
        headers=handler_b,
    )
    assert acknowledge.status_code == 404
    resolve = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={
            "target_status": "resolved",
            "resolution": "Trying from the wrong department",
            "expected_version": 5,
        },
        headers=handler_b,
    )
    assert resolve.status_code == 404
    internal = client.post(
        f"/api/v1/incidents/{incident_id}/comments",
        json={"body": "Trying to comment", "visibility": "internal", "expected_version": 5},
        headers=handler_b,
    )
    assert internal.status_code == 404
    upload = client.post(
        f"/api/v1/incidents/{incident_id}/attachments",
        files={"file": ("sneaky.pdf", PDF, "application/pdf")},
        data={"expected_version": "5"},
        headers=handler_b,
    )
    assert upload.status_code == 404
    download = client.get(
        f"/api/v1/incidents/{incident_id}/attachments/{attachment_id}/download",
        headers=handler_b,
    )
    assert download.status_code == 404

    manager_b = case.headers["manager_b"]
    assign = client.post(
        f"/api/v1/incidents/{incident_id}/assign",
        json={
            "department_id": str(case.electrical.id),
            "handler_id": str(case.users["handler_b"].id),
            "reason": "Trying to take it over",
            "expected_version": 5,
        },
        headers=manager_b,
    )
    assert assign.status_code == 404
    dispose = client.post(
        f"/api/v1/incidents/{incident_id}/disposition",
        json={"kind": "invalid", "reason": "Trying to close it", "expected_version": 5},
        headers=manager_b,
    )
    assert dispose.status_code == 404

    own = get_incident(client, case.headers["manager_a"], incident_id)
    assert own["version"] == 5 and own["status"] == "assigned"


def test_unauthorized_close_and_reopen_are_blocked(client, case):
    """T09: close/reopen need a manager or admin, plus a reason to reopen."""
    incident_id = drive_to_resolved(client, case)

    close_by_reporter = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={
            "target_status": "closed",
            "reason": "Reporter tries to close",
            "expected_version": 4,
        },
        headers=case.headers["reporter_a"],
    )
    assert close_by_reporter.status_code == 403
    assert close_by_reporter.json()["error"]["code"] == "forbidden"
    close_by_handler = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "closed", "reason": "Handler tries to close", "expected_version": 4},
        headers=case.headers["handler_a"],
    )
    assert close_by_handler.status_code == 403
    return_by_reporter = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "in_progress", "reason": "Reporter tries", "expected_version": 4},
        headers=case.headers["reporter_a"],
    )
    assert return_by_reporter.status_code == 403
    return_by_handler = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "in_progress", "reason": "Handler tries", "expected_version": 4},
        headers=case.headers["handler_a"],
    )
    assert return_by_handler.status_code == 403
    dispose_by_reporter = client.post(
        f"/api/v1/incidents/{incident_id}/disposition",
        json={"kind": "invalid", "reason": "Reporter tries", "expected_version": 4},
        headers=case.headers["reporter_a"],
    )
    assert dispose_by_reporter.status_code == 403
    dispose_by_handler = client.post(
        f"/api/v1/incidents/{incident_id}/disposition",
        json={"kind": "invalid", "reason": "Handler tries", "expected_version": 4},
        headers=case.headers["handler_a"],
    )
    assert dispose_by_handler.status_code == 403

    incident = get_incident(client, case.headers["manager_a"], incident_id)
    assert incident["status"] == "resolved" and incident["version"] == 4

    # A manager may close without a reason.
    closed = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "closed", "expected_version": 4},
        headers=case.headers["manager_a"],
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["incident"]["status"] == "closed"
    assert closed.json()["incident"]["version"] == 5

    reopen_by_reporter = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "in_progress", "reason": "Reporter tries", "expected_version": 5},
        headers=case.headers["reporter_a"],
    )
    assert reopen_by_reporter.status_code == 403
    reopen_by_handler = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "in_progress", "reason": "Handler tries", "expected_version": 5},
        headers=case.headers["handler_a"],
    )
    assert reopen_by_handler.status_code == 403
    reopen_without_reason = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "in_progress", "expected_version": 5},
        headers=case.headers["manager_a"],
    )
    assert reopen_without_reason.status_code == 422
    assert reopen_without_reason.json()["error"]["code"] == "validation_error"

    reopened = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={
            "target_status": "in_progress",
            "reason": "Leak reported again",
            "expected_version": 5,
        },
        headers=case.headers["manager_a"],
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["incident"]["status"] == "in_progress"
    assert reopened.json()["incident"]["version"] == 6


def test_negative_transitions_through_real_api(client, case):
    """Unlisted edges and bad payloads fail without side effects."""
    created = create_incident(client, case.headers["reporter_a"])
    incident_id = UUID(created["id"])
    manager = case.headers["manager_a"]
    handler = case.headers["handler_a"]

    # A handler who is not assigned yet cannot even see the incident.
    reported_to_resolved_by_handler = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "resolved", "resolution": "Too early", "expected_version": 1},
        headers=handler,
    )
    assert reported_to_resolved_by_handler.status_code == 404
    assert reported_to_resolved_by_handler.json()["error"]["code"] == "not_found"

    # The department manager can see it, so the edge check runs: 409.
    reported_to_resolved = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "resolved", "resolution": "Too early", "expected_version": 1},
        headers=manager,
    )
    assert reported_to_resolved.status_code == 409
    assert reported_to_resolved.json()["error"]["code"] == "invalid_transition"

    assigned = client.post(
        f"/api/v1/incidents/{incident_id}/assign",
        json={
            "department_id": str(case.facilities.id),
            "handler_id": str(case.users["handler_a"].id),
            "reason": "Assign to facilities handler",
            "expected_version": 1,
        },
        headers=manager,
    )
    assert assigned.status_code == 200, assigned.text

    assigned_to_resolved = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "resolved", "resolution": "Too early", "expected_version": 2},
        headers=handler,
    )
    assert assigned_to_resolved.status_code == 409

    acknowledged = client.post(
        f"/api/v1/incidents/{incident_id}/acknowledge",
        json={"expected_version": 2},
        headers=handler,
    )
    assert acknowledged.status_code == 200, acknowledged.text

    in_progress_to_closed = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "closed", "reason": "Skipping resolve", "expected_version": 3},
        headers=manager,
    )
    assert in_progress_to_closed.status_code == 409
    resolve_without_resolution = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "resolved", "expected_version": 3},
        headers=handler,
    )
    assert resolve_without_resolution.status_code == 422
    assert resolve_without_resolution.json()["error"]["code"] == "validation_error"

    resolved = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "resolved", "resolution": "Fixed it", "expected_version": 3},
        headers=handler,
    )
    assert resolved.status_code == 200, resolved.text

    resolved_again = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "resolved", "resolution": "Again", "expected_version": 4},
        headers=handler,
    )
    assert resolved_again.status_code == 409
    return_without_reason = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "in_progress", "expected_version": 4},
        headers=manager,
    )
    assert return_without_reason.status_code == 422

    closed = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "closed", "reason": "Confirmed fixed", "expected_version": 4},
        headers=manager,
    )
    assert closed.status_code == 200, closed.text

    closed_to_resolved = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={"target_status": "resolved", "resolution": "Too late", "expected_version": 5},
        headers=handler,
    )
    assert closed_to_resolved.status_code == 409
    dispose_closed = client.post(
        f"/api/v1/incidents/{incident_id}/disposition",
        json={"kind": "invalid", "reason": "Already closed", "expected_version": 5},
        headers=manager,
    )
    assert dispose_closed.status_code == 409

    reopened = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={
            "target_status": "in_progress",
            "reason": "Leak reported again",
            "expected_version": 5,
        },
        headers=manager,
    )
    assert reopened.status_code == 200, reopened.text

    duplicate_self = client.post(
        f"/api/v1/incidents/{incident_id}/disposition",
        json={
            "kind": "duplicate",
            "reason": "Points to itself",
            "duplicate_of_id": str(incident_id),
            "expected_version": 6,
        },
        headers=manager,
    )
    assert duplicate_self.status_code == 422
    duplicate_missing = client.post(
        f"/api/v1/incidents/{incident_id}/disposition",
        json={
            "kind": "duplicate",
            "reason": "Points nowhere",
            "duplicate_of_id": str(uuid4()),
            "expected_version": 6,
        },
        headers=manager,
    )
    assert duplicate_missing.status_code == 422

    disposed = client.post(
        f"/api/v1/incidents/{incident_id}/disposition",
        json={"kind": "invalid", "reason": "Not a real incident", "expected_version": 6},
        headers=manager,
    )
    assert disposed.status_code == 200, disposed.text
    incident = get_incident(client, manager, incident_id)
    assert incident["status"] == "closed" and incident["version"] == 7
