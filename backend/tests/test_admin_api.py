"""W6 acceptance tests against the real API and PostgreSQL transaction."""

from uuid import uuid4

import pytest
from sqlalchemy import select

from app.admin.models import AdminAuditLog
from app.auth.models import Session as UserSession
from app.auth.security import hash_password, verify_password
from app.incidents.models import Incident
from app.models import Department, User
from app.rules.models import RuleVersion
from app.workflow.models import AuditLog

PASSWORD = "Test-password-123!"


@pytest.fixture
def admin(client, db_session):
    user = User(
        id=uuid4(),
        email=f"w6-admin-{uuid4().hex}@example.com",
        display_name="W6 Administrator",
        password_hash=hash_password(PASSWORD),
        role="administrator",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    login = client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return user, {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.parametrize("path", ["users", "departments", "rules"])
def test_admin_reads_require_administrator(client, auth_headers, path):
    url = f"/api/v1/admin/{path}"
    assert client.get(url).status_code == 401
    denied = client.get(url, headers=auth_headers)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "forbidden"


def test_non_admin_cannot_mutate_and_admin_cannot_lock_self(
    client, db_session, auth_headers, admin
):
    actor, headers = admin
    count_before = db_session.query(AdminAuditLog).count()
    denied = client.post(
        "/api/v1/admin/departments", json={"name": "Should not be created"}, headers=auth_headers
    )
    assert denied.status_code == 403
    self_lock = client.patch(
        f"/api/v1/admin/users/{actor.id}", json={"is_active": False}, headers=headers
    )
    assert self_lock.status_code == 409
    assert db_session.get(User, actor.id).is_active is True
    assert db_session.query(AdminAuditLog).count() == count_before


def test_create_and_lock_user_is_audited_and_revokes_session(client, db_session, admin):
    actor, headers = admin
    department = client.post(
        "/api/v1/admin/departments", json={"name": f"W6 department {uuid4().hex}"}, headers=headers
    )
    assert department.status_code == 201, department.text
    department_id = department.json()["id"]
    department_audit = db_session.scalar(
        select(AdminAuditLog).where(AdminAuditLog.target_id == department_id)
    )
    assert department_audit.action == "department.created"
    email = f"w6-handler-{uuid4().hex}@example.com"
    password = "Separate-password-123!"
    request_id = str(uuid4())
    created = client.post(
        "/api/v1/admin/users",
        json={
            "email": email,
            "display_name": "Demo Handler",
            "role": "handler",
            "department_id": department_id,
            "password": password,
        },
        headers={**headers, "X-Request-ID": request_id},
    )
    assert created.status_code == 201, created.text
    assert created.headers["X-Request-ID"] == request_id
    assert "password" not in created.text
    user_id = created.json()["id"]
    user = db_session.get(User, user_id)
    assert user.password_hash != password and verify_password(password, user.password_hash)

    login = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    token = login.json()["access_token"]
    locked = client.patch(
        f"/api/v1/admin/users/{user_id}", json={"is_active": False}, headers=headers
    )
    assert locked.status_code == 200 and locked.json()["is_active"] is False
    assert (
        client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code
        == 401
    )
    assert (
        client.post("/api/v1/auth/login", json={"email": email, "password": password}).status_code
        == 401
    )
    assert all(
        session.revoked_at is not None
        for session in db_session.scalars(select(UserSession).where(UserSession.user_id == user.id))
    )
    audits = db_session.scalars(
        select(AdminAuditLog)
        .where(AdminAuditLog.target_id == user.id)
        .order_by(AdminAuditLog.created_at)
    ).all()
    assert {entry.action for entry in audits} == {"user.created", "user.updated"}
    assert all(entry.actor_id == actor.id for entry in audits)
    assert all(password not in str(entry.before) + str(entry.after) for entry in audits)
    assert any(str(entry.request_id) == request_id for entry in audits)


def test_user_filters_cursor_and_role_change_revoke_token(client, db_session, admin):
    _, headers = admin
    ids = []
    for _ in range(2):
        response = client.post(
            "/api/v1/admin/users",
            json={
                "email": f"w6-reporter-{uuid4().hex}@example.com",
                "display_name": "Reporter",
                "role": "reporter",
                "password": PASSWORD,
            },
            headers=headers,
        )
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])
    first = client.get("/api/v1/admin/users?role=reporter&limit=1", headers=headers)
    assert first.status_code == 200
    assert len(first.json()["items"]) == 1 and first.json()["next_cursor"]
    second = client.get(
        "/api/v1/admin/users",
        params={"role": "reporter", "limit": 1, "cursor": first.json()["next_cursor"]},
        headers=headers,
    )
    assert second.status_code == 200
    assert {first.json()["items"][0]["id"], second.json()["items"][0]["id"]} == set(ids)

    user = db_session.get(User, ids[0])
    login = client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    token = login.json()["access_token"]
    changed = client.patch(
        f"/api/v1/admin/users/{user.id}", json={"role": "administrator"}, headers=headers
    )
    assert changed.status_code == 200 and changed.json()["role"] == "administrator"
    assert (
        client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code
        == 401
    )


def test_rule_version_is_validated_immutable_and_not_activated(client, db_session, admin):
    _, headers = admin
    department = Department(id=uuid4(), name=f"Rule department {uuid4().hex}")
    db_session.add(department)
    db_session.flush()
    payload = {
        "version": f"w6-{uuid4().hex[:12]}",
        "rules": [
            {
                "rule_id": "R01",
                "category": "water_leak",
                "condition": {"near_electricity": "yes"},
                "severity": "high",
                "priority": "p1",
                "department": department.name,
                "reason": "Safety review needed",
            }
        ],
    }
    created = client.post("/api/v1/admin/rules/versions", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    assert created.json()["is_active"] is False
    assert (
        client.post("/api/v1/admin/rules/versions", json=payload, headers=headers).status_code
        == 409
    )
    invalid = {
        **payload,
        "version": payload["version"] + "-bad",
        "rules": [{**payload["rules"][0], "condition": {"interaction": "clicked_link"}}],
    }
    assert (
        client.post("/api/v1/admin/rules/versions", json=invalid, headers=headers).status_code
        == 422
    )
    assert db_session.scalar(select(RuleVersion).where(RuleVersion.version == payload["version"]))
    audit = db_session.scalar(
        select(AdminAuditLog).where(AdminAuditLog.target_id == created.json()["id"])
    )
    assert audit.action == "rule_version.created" and audit.after["is_active"] is False


def test_admin_can_view_and_assign_incident_in_another_department(
    client, db_session, admin, test_user
):
    _, headers = admin
    department = Department(id=uuid4(), name=f"Elsewhere {uuid4().hex}")
    incident = Incident(
        id=uuid4(),
        reporter_id=test_user.id,
        category="water_leak",
        title="Water leak in lab",
        description="Water is leaking near the laboratory entrance.",
        building="Building A",
        answers={"leak_amount": "small", "near_electricity": "no"},
    )
    db_session.add_all([department, incident])
    db_session.flush()
    listed = client.get("/api/v1/incidents", headers=headers)
    detail = client.get(f"/api/v1/incidents/{incident.id}", headers=headers)
    assert listed.status_code == detail.status_code == 200
    assert str(incident.id) in {item["id"] for item in listed.json()["items"]}
    assigned = client.post(
        f"/api/v1/incidents/{incident.id}/assign",
        json={
            "department_id": str(department.id),
            "handler_id": None,
            "reason": "Administrator routes to the right department",
            "expected_version": 1,
        },
        headers=headers,
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["incident"]["department_id"] == str(department.id)
    acknowledged = client.post(
        f"/api/v1/incidents/{incident.id}/acknowledge",
        json={"expected_version": 2},
        headers=headers,
    )
    assert acknowledged.status_code == 200, acknowledged.text
    assert acknowledged.json()["incident"]["status"] == "in_progress"
    actions = set(
        db_session.scalars(select(AuditLog.action).where(AuditLog.incident_id == incident.id)).all()
    )
    assert {"incident.assigned", "incident.acknowledged"} <= actions
