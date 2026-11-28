"""N4 W8: full lifecycle through the real API on real PostgreSQL.

Reporter creates a real incident (N2), a real demo-v1 rule evaluation (N3)
decides its department and priority, then the whole lifecycle runs through
the real workflow API with real N1 bearer tokens: assign -> acknowledge ->
comment -> resolve -> close -> reopen -> disposition. No contract change:
same request/response shapes and error codes as the service-level tests.
Requires TEST_DATABASE_URL pointing at campus_incident_test (see
docs/development.md).
"""

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.auth.security import hash_password
from app.incidents.models import Incident
from app.models import Department, User
from app.rules.engine import evaluate_incident

PASSWORD = "w8-real-api-integration-pass"

WATER_LEAK_NEAR_POWER = {
    "category": "water_leak",
    "title": "Leak near classroom 205",
    "description": "Water is dripping from the ceiling onto the hallway floor.",
    "building": "Building A",
    "location_detail": "Floor 2",
    "answers": {"leak_amount": "small", "near_electricity": "yes", "slip_risk": True},
}


@pytest.fixture
def case(client, db_session):
    """Seed departments and users; log each in through the real auth API."""
    facilities = Department(id=uuid4(), name="Cơ sở vật chất")
    electrical = Department(id=uuid4(), name="Điện và an toàn")
    db_session.add_all([facilities, electrical])
    db_session.flush()

    users = {}
    headers = {}
    for label, role, department in (
        ("reporter", "reporter", None),
        ("handler", "handler", facilities),
        ("manager", "department_manager", facilities),
        ("other_handler", "handler", electrical),
        ("admin", "administrator", None),
    ):
        user = User(
            id=uuid4(),
            email=f"w8-{label}-{uuid4().hex}@example.com",
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
    """Stand-in for N3's create/triage integration (their W8 branch).

    Runs the real demo-v1 engine on the incident's answers and records the
    result the way the triage integration will: department, priority,
    severity and the evaluation payload.
    """
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


def get_incident(client, headers, incident_id):
    response = client.get(f"/api/v1/incidents/{incident_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_full_lifecycle_through_real_api(client, case):
    created = create_incident(client, case.headers["reporter"])
    incident_id = UUID(created["id"])
    assert created["status"] == "reported"
    assert created["version"] == 1
    assert created["priority"] is None
    assert created["department_id"] is None

    result = apply_rule(case, incident_id)
    assert result.rule_id == "R03"
    assert result.priority == "p1"
    assert result.department == "Cơ sở vật chất"

    assigned = client.post(
        f"/api/v1/incidents/{incident_id}/assign",
        json={
            "department_id": str(case.facilities.id),
            "handler_id": str(case.users["handler"].id),
            "reason": "Assign to facilities handler",
            "expected_version": 1,
        },
        headers=case.headers["manager"],
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["incident"]["status"] == "assigned"
    assert assigned.json()["incident"]["version"] == 2
    assert assigned.json()["incident"]["department_id"] == str(case.facilities.id)
    assert assigned.json()["history_id"]

    incident = get_incident(client, case.headers["manager"], incident_id)
    assert incident["status"] == "assigned" and incident["version"] == 2
    assert incident["priority"] == "p1"
    assert incident["rule_evaluation"]["rule_id"] == "R03"

    acknowledged = client.post(
        f"/api/v1/incidents/{incident_id}/acknowledge",
        json={"expected_version": 2},
        headers=case.headers["handler"],
    )
    assert acknowledged.status_code == 200, acknowledged.text
    assert acknowledged.json()["incident"]["status"] == "in_progress"
    assert acknowledged.json()["incident"]["version"] == 3
    assert acknowledged.json()["incident"]["acknowledged_at"] is not None

    commented = client.post(
        f"/api/v1/incidents/{incident_id}/comments",
        json={
            "body": "On my way to check the leak",
            "visibility": "public",
            "expected_version": 3,
        },
        headers=case.headers["handler"],
    )
    assert commented.status_code == 201, commented.text

    incident = get_incident(client, case.headers["manager"], incident_id)
    assert incident["version"] == 4

    resolved = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={
            "target_status": "resolved",
            "resolution": "Fixed the leak and dried the floor",
            "expected_version": 4,
        },
        headers=case.headers["handler"],
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["incident"]["status"] == "resolved"
    assert resolved.json()["incident"]["version"] == 5
    assert resolved.json()["incident"]["resolved_at"] is not None

    closed = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={
            "target_status": "closed",
            "reason": "Confirmed fixed",
            "expected_version": 5,
        },
        headers=case.headers["manager"],
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["incident"]["status"] == "closed"
    assert closed.json()["incident"]["version"] == 6
    assert closed.json()["incident"]["closed_at"] is not None

    reopened = client.post(
        f"/api/v1/incidents/{incident_id}/transitions",
        json={
            "target_status": "in_progress",
            "reason": "Leak reported again",
            "expected_version": 6,
        },
        headers=case.headers["manager"],
    )
    assert reopened.status_code == 200, reopened.text
    body = reopened.json()["incident"]
    assert body["status"] == "in_progress"
    assert body["version"] == 7
    assert body["resolved_at"] is not None and body["closed_at"] is not None

    disposed = client.post(
        f"/api/v1/incidents/{incident_id}/disposition",
        json={
            "kind": "invalid",
            "reason": "Not a real incident after all",
            "expected_version": 7,
        },
        headers=case.headers["manager"],
    )
    assert disposed.status_code == 200, disposed.text
    assert disposed.json()["incident"]["status"] == "closed"
    assert disposed.json()["incident"]["version"] == 8

    incident = get_incident(client, case.headers["manager"], incident_id)
    assert incident["status"] == "closed" and incident["version"] == 8


def test_comment_visibility_through_real_api(client, case):
    created = create_incident(client, case.headers["reporter"])
    incident_id = UUID(created["id"])
    apply_rule(case, incident_id)

    assigned = client.post(
        f"/api/v1/incidents/{incident_id}/assign",
        json={
            "department_id": str(case.facilities.id),
            "handler_id": str(case.users["handler"].id),
            "reason": "Assign to facilities handler",
            "expected_version": 1,
        },
        headers=case.headers["manager"],
    )
    assert assigned.status_code == 200, assigned.text

    internal = client.post(
        f"/api/v1/incidents/{incident_id}/comments",
        json={
            "body": "Internal note for staff",
            "visibility": "internal",
            "expected_version": 2,
        },
        headers=case.headers["handler"],
    )
    assert internal.status_code == 201, internal.text

    public = client.post(
        f"/api/v1/incidents/{incident_id}/comments",
        json={
            "body": "We are looking into it",
            "visibility": "public",
            "expected_version": 3,
        },
        headers=case.headers["handler"],
    )
    assert public.status_code == 201, public.text

    reporter_view = client.get(
        f"/api/v1/incidents/{incident_id}/comments",
        headers=case.headers["reporter"],
    )
    assert reporter_view.status_code == 200, reporter_view.text
    seen = [item["visibility"] for item in reporter_view.json()["items"]]
    assert seen == ["public"]

    manager_view = client.get(
        f"/api/v1/incidents/{incident_id}/comments",
        headers=case.headers["manager"],
    )
    assert manager_view.status_code == 200, manager_view.text
    assert {item["visibility"] for item in manager_view.json()["items"]} == {
        "public",
        "internal",
    }


def test_workflow_error_codes_through_real_api(client, case):
    created = create_incident(client, case.headers["reporter"])
    incident_id = UUID(created["id"])
    apply_rule(case, incident_id)

    assigned = client.post(
        f"/api/v1/incidents/{incident_id}/assign",
        json={
            "department_id": str(case.facilities.id),
            "handler_id": str(case.users["handler"].id),
            "reason": "Assign to facilities handler",
            "expected_version": 1,
        },
        headers=case.headers["manager"],
    )
    assert assigned.status_code == 200, assigned.text

    stale = client.post(
        f"/api/v1/incidents/{incident_id}/acknowledge",
        json={"expected_version": 1},
        headers=case.headers["handler"],
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "version_conflict"

    forbidden = client.post(
        f"/api/v1/incidents/{incident_id}/assign",
        json={
            "department_id": str(case.facilities.id),
            "handler_id": str(case.users["handler"].id),
            "reason": "Reporter cannot assign",
            "expected_version": 2,
        },
        headers=case.headers["reporter"],
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "forbidden"

    out_of_scope = client.post(
        f"/api/v1/incidents/{incident_id}/acknowledge",
        json={"expected_version": 2},
        headers=case.headers["other_handler"],
    )
    assert out_of_scope.status_code == 404
    assert out_of_scope.json()["error"]["code"] == "not_found"

    missing = client.get(
        f"/api/v1/incidents/{uuid4()}",
        headers=case.headers["manager"],
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
