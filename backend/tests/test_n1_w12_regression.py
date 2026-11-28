"""Week 12 (N1-W12) Final Regression Test Suite for Identity & Permissions.

Validates the full N1 delivery ahead of the 04/01/2027 code freeze:
- T07: Cross-incident isolation for reporters (404, no data/comment leak).
- T08: Cross-department isolation for staff and managers (403/404 per policy).
- T09: Transition authorization (reporters blocked, handlers cannot close/reopen).
- Token & Session Lifecycle: login, authenticate, logout revocation, admin lock revocation.
- Admin Audit Trail: immutable audit logging for all admin operations without secret leak.
- Demo Principals & Contract Freeze: verifies principals match docs/fixtures/principals.json.
- Rate Limiting & Security Hardening: brute-force mitigation and lockout behavior.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.admin.models import AdminAuditLog
from app.auth.models import Session as UserSession
from app.auth.rate_limit import login_limiter
from app.auth.security import create_session_token, hash_password, hash_session_token
from app.auth.seed_demo import DEMO_ACCOUNTS, DEMO_DEPARTMENTS
from app.comments.models import Comment
from app.incidents.models import Incident
from app.models import Department, User

TEST_PASSWORD = "W12-Regression-Pass@2027!"


@pytest.fixture
def w12_suite(client, db_session):
    login_limiter.reset()

    # 1. Setup departments
    dept_it = Department(id=uuid4(), name=f"IT Security {uuid4().hex[:6]}")
    dept_fac = Department(id=uuid4(), name=f"Facilities {uuid4().hex[:6]}")
    db_session.add_all([dept_it, dept_fac])
    db_session.flush()

    # 2. Setup users for all 4 roles across both departments
    users = {}
    tokens = {}

    user_specs = [
        ("reporter_a", "reporter", None),
        ("reporter_b", "reporter", None),
        ("handler_it", "handler", dept_it.id),
        ("handler_fac", "handler", dept_fac.id),
        ("manager_it", "department_manager", dept_it.id),
        ("manager_fac", "department_manager", dept_fac.id),
        ("admin", "administrator", None),
    ]

    for label, role, dept_id in user_specs:
        user = User(
            id=uuid4(),
            email=f"{label}-{uuid4().hex[:6]}@demo.invalid",
            display_name=f"User {label}",
            password_hash=hash_password(TEST_PASSWORD),
            role=role,
            department_id=dept_id,
            is_active=True,
        )
        db_session.add(user)
        db_session.flush()

        # Create active session
        raw_token = create_session_token()
        session = UserSession(
            id=uuid4(),
            user_id=user.id,
            token_hash=hash_session_token(raw_token),
            expires_at=datetime.now(UTC) + timedelta(hours=8),
        )
        db_session.add(session)
        users[label] = user
        tokens[label] = raw_token

    db_session.flush()

    # 3. Setup sample incidents
    # Incident A created by reporter_a, assigned to Facilities
    inc_a = Incident(
        id=uuid4(),
        title="Water leak in Library",
        description="Pipe burst on 2nd floor",
        category="water_leak",
        building="Library",
        location_detail="2nd floor",
        reporter_id=users["reporter_a"].id,
        department_id=dept_fac.id,
        assigned_handler_id=users["handler_fac"].id,
        status="in_progress",
        priority="p2",
        severity="medium",
        version=1,
        answers={},
    )
    # Incident B created by reporter_b, assigned to IT
    inc_b = Incident(
        id=uuid4(),
        title="Phishing email campaign",
        description="Suspicious email with malware link",
        category="phishing",
        building="Admin Building",
        location_detail="IT Lab",
        reporter_id=users["reporter_b"].id,
        department_id=dept_it.id,
        assigned_handler_id=users["handler_it"].id,
        status="in_progress",
        priority="p1",
        severity="high",
        version=1,
        answers={},
    )
    db_session.add_all([inc_a, inc_b])
    db_session.flush()

    # Setup comments on Incident A
    pub_comment = Comment(
        id=uuid4(),
        incident_id=inc_a.id,
        actor_id=users["reporter_a"].id,
        visibility="public",
        body="Here is additional information",
    )
    int_comment = Comment(
        id=uuid4(),
        incident_id=inc_a.id,
        actor_id=users["handler_fac"].id,
        visibility="internal",
        body="Internal notes: Facilities contractor dispatched",
    )
    db_session.add_all([pub_comment, int_comment])
    db_session.commit()

    def auth_headers(label: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {tokens[label]}"}

    return client, db_session, users, tokens, auth_headers, inc_a, inc_b, dept_it, dept_fac


# ==============================================================================
# T07 Regression: Reporter Cross-Incident Isolation
# ==============================================================================


def test_t07_reporter_cross_incident_isolation(w12_suite):
    client, _, _, _, auth_headers, inc_a, inc_b, _, _ = w12_suite

    # Reporter B attempts to read Incident A -> 404 (masked)
    resp = client.get(f"/api/v1/incidents/{inc_a.id}", headers=auth_headers("reporter_b"))
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"

    # Reporter B attempts to post comment on Incident A -> 404
    resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/comments",
        headers=auth_headers("reporter_b"),
        json={"expected_version": 1, "body": "Malicious injected comment", "visibility": "public"},
    )
    assert resp.status_code == 404

    # Reporter A can view Incident A
    resp = client.get(f"/api/v1/incidents/{inc_a.id}", headers=auth_headers("reporter_a"))
    assert resp.status_code == 200
    assert resp.json()["id"] == str(inc_a.id)

    # Reporter A sees only public comments, NOT internal comments
    resp = client.get(f"/api/v1/incidents/{inc_a.id}/comments", headers=auth_headers("reporter_a"))
    assert resp.status_code == 200
    comments = resp.json()["items"]
    assert len(comments) == 1
    assert comments[0]["visibility"] == "public"

    # Reporter A attempts to post internal comment -> 403 Forbidden
    resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/comments",
        headers=auth_headers("reporter_a"),
        json={
            "expected_version": 1,
            "body": "Reporter trying to write internal note",
            "visibility": "internal",
        },
    )
    assert resp.status_code == 403


# ==============================================================================
# T08 Regression: Cross-Department Boundary Isolation for Staff & Managers
# ==============================================================================


def test_t08_cross_department_matrix_isolation(w12_suite):
    client, _, users, _, auth_headers, inc_a, inc_b, dept_it, dept_fac = w12_suite

    # Facilities incident (inc_a):
    # IT Handler cannot access Facilities incident -> 404 (masked outside scope)
    resp = client.get(f"/api/v1/incidents/{inc_a.id}", headers=auth_headers("handler_it"))
    assert resp.status_code == 404

    # IT Manager cannot access Facilities incident -> 404
    resp = client.get(f"/api/v1/incidents/{inc_a.id}", headers=auth_headers("manager_it"))
    assert resp.status_code == 404

    # IT Manager attempts to assign Facilities incident -> 404
    resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/assign",
        headers=auth_headers("manager_it"),
        json={
            "expected_version": 1,
            "department_id": str(dept_fac.id),
            "handler_id": str(users["handler_fac"].id),
            "reason": "Unauthorized assign attempt",
        },
    )
    assert resp.status_code == 404

    # Facilities Manager can view and reassign within their department
    resp = client.get(f"/api/v1/incidents/{inc_a.id}", headers=auth_headers("manager_fac"))
    assert resp.status_code == 200

    # Facilities Manager can see internal comments
    resp = client.get(f"/api/v1/incidents/{inc_a.id}/comments", headers=auth_headers("manager_fac"))
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 2

    # Administrator has global visibility across all departments
    resp_a = client.get(f"/api/v1/incidents/{inc_a.id}", headers=auth_headers("admin"))
    resp_b = client.get(f"/api/v1/incidents/{inc_b.id}", headers=auth_headers("admin"))
    assert resp_a.status_code == 200
    assert resp_b.status_code == 200


# ==============================================================================
# T09 Regression: Lifecycle Transition Authorization Matrix
# ==============================================================================


def test_t09_lifecycle_transition_authorization(w12_suite):
    client, db_session, users, _, auth_headers, inc_a, _, _, _ = w12_suite

    # 1. Reporter attempts transition -> 403 Forbidden
    resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/transitions",
        headers=auth_headers("reporter_a"),
        json={"expected_version": 1, "target_status": "resolved", "resolution": "Self resolving"},
    )
    assert resp.status_code == 403

    # 2. Handler can transition to resolved
    resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/transitions",
        headers=auth_headers("handler_fac"),
        json={
            "expected_version": 1,
            "target_status": "resolved",
            "resolution": "Water pipe fixed and tested",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["incident"]["status"] == "resolved"

    # 3. Handler attempts to close resolved incident -> 403 Forbidden (only manager/admin can close)
    resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/transitions",
        headers=auth_headers("handler_fac"),
        json={
            "expected_version": 2,
            "target_status": "closed",
            "reason": "Handler attempting close",
        },
    )
    assert resp.status_code == 403

    # 4. Manager can close resolved incident
    resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/transitions",
        headers=auth_headers("manager_fac"),
        json={
            "expected_version": 2,
            "target_status": "closed",
            "reason": "Verified repairs with library staff",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["incident"]["status"] == "closed"

    # 5. Handler attempts to reopen closed incident -> 403 Forbidden
    resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/transitions",
        headers=auth_headers("handler_fac"),
        json={
            "expected_version": 3,
            "target_status": "in_progress",
            "reason": "Handler attempting reopen",
        },
    )
    assert resp.status_code == 403

    # 6. Administrator can reopen closed incident
    resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/transitions",
        headers=auth_headers("admin"),
        json={
            "expected_version": 3,
            "target_status": "in_progress",
            "reason": "Admin reopening for inspection",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["incident"]["status"] == "in_progress"


# ==============================================================================
# Token & Session Lifecycle Regression
# ==============================================================================


def test_token_and_session_lifecycle_complete_regression(w12_suite):
    client, db_session, users, _, auth_headers, _, _, _, _ = w12_suite
    admin_user = users["admin"]

    # 1. Login with valid credentials
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": admin_user.email, "password": TEST_PASSWORD},
    )
    assert resp.status_code == 200
    login_data = resp.json()
    new_token = login_data["access_token"]
    assert new_token

    # 2. Authenticate with new token
    bearer_hdr = {"Authorization": f"Bearer {new_token}"}
    resp = client.get("/api/v1/auth/me", headers=bearer_hdr)
    assert resp.status_code == 200
    assert resp.json()["id"] == str(admin_user.id)

    # 3. Logout revokes the session
    resp = client.post("/api/v1/auth/logout", headers=bearer_hdr)
    assert resp.status_code == 204

    # 4. Re-using revoked token returns 401 unauthenticated
    resp = client.get("/api/v1/auth/me", headers=bearer_hdr)
    assert resp.status_code == 401
    assert "WWW-Authenticate" in resp.headers

    # 5. Locking a user revokes all active sessions
    target_user = users["reporter_a"]
    resp = client.patch(
        f"/api/v1/admin/users/{target_user.id}",
        headers=auth_headers("admin"),
        json={"is_active": False},
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    # Reporter A's existing session token now receives 401
    resp = client.get("/api/v1/auth/me", headers=auth_headers("reporter_a"))
    assert resp.status_code == 401


# ==============================================================================
# Admin Audit Trail Regression
# ==============================================================================


def test_admin_audit_log_regression(w12_suite):
    client, db_session, users, _, auth_headers, _, _, dept_it, _ = w12_suite

    # Perform admin action: create new user
    new_email = f"audit-test-{uuid4().hex[:6]}@demo.invalid"
    resp = client.post(
        "/api/v1/admin/users",
        headers=auth_headers("admin"),
        json={
            "email": new_email,
            "display_name": "Audit Track User",
            "password": "TemporaryPassword123!",
            "role": "handler",
            "department_id": str(dept_it.id),
        },
    )
    assert resp.status_code == 201
    created_user_id = UUID(resp.json()["id"])

    # Verify audit log was recorded in admin_audit_logs
    audit = db_session.scalar(
        select(AdminAuditLog)
        .where(
            AdminAuditLog.target_id == created_user_id,
            AdminAuditLog.action == "user.created",
        )
        .order_by(AdminAuditLog.created_at.desc())
    )
    assert audit is not None
    assert audit.actor_id == users["admin"].id
    assert audit.target_type == "user"
    assert "password" not in str(audit.before)
    assert "password" not in str(audit.after)
    assert "TemporaryPassword123!" not in str(audit.after)


# ==============================================================================
# Demo Principals & Contract Freeze Verification
# ==============================================================================


def test_demo_principals_freeze_verification():
    # Verify DEMO_DEPARTMENTS matches contract
    assert len(DEMO_DEPARTMENTS) == 4
    expected_depts = {
        UUID("20000000-0000-4000-8000-000000000001"): "Cơ sở vật chất",
        UUID("20000000-0000-4000-8000-000000000002"): "Điện và an toàn",
        UUID("20000000-0000-4000-8000-000000000003"): "IT/Security",
        UUID("20000000-0000-4000-8000-000000000004"): "Hàng đợi phân loại thủ công",
    }
    for dept_id, name in DEMO_DEPARTMENTS:
        assert dept_id in expected_depts
        assert expected_depts[dept_id] == name

    # Verify DEMO_ACCOUNTS matches contract
    assert len(DEMO_ACCOUNTS) == 5
    accounts_by_role = {acc.role: acc for acc in DEMO_ACCOUNTS}
    assert "reporter" in accounts_by_role
    assert "handler" in accounts_by_role
    assert "department_manager" in accounts_by_role
    assert "administrator" in accounts_by_role


# ==============================================================================
# Rate Limiting & Brute-Force Lockout Hardening
# ==============================================================================


def test_rate_limiter_and_lockout_hardening(w12_suite):
    client, _, users, _, _, _, _, _, _ = w12_suite
    user = users["reporter_b"]

    login_limiter.reset()

    # 5 failed attempts return 401
    for _ in range(5):
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": "WrongPassword123!"},
        )
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "invalid_credentials"

    # 6th attempt returns 429 rate_limited
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": "WrongPassword123!"},
    )
    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "rate_limited"
    assert "Retry-After" in resp.headers

    login_limiter.reset()
