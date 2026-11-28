"""Week 8 (N1-W08) Comprehensive negative test matrix on large multi-role seed dataset.

Validates:
- 401: missing token, wrong scheme, invalid token, expired session, revoked session, locked user.
- 404: record-scope enforcement (cross-reporter, cross-department,
  intra-department unassigned handler, non-existent UUID).
- 403: forbidden operations inside visible scope (reporter transition,
  reporter internal comments, handler reassign, handler close, non-admin admin APIs).
- 429: login rate limit enforcement.
- Session revocation on logout and admin lock.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.auth.models import Session as UserSession
from app.auth.rate_limit import login_limiter
from app.auth.security import create_session_token, hash_session_token
from app.auth.seed_large import (
    DEFAULT_LARGE_PASSWORD,
    create_scoped_incidents_for_matrix,
    seed_large_dataset,
)


@pytest.fixture
def matrix_env(db_session, client):
    dataset = seed_large_dataset(db_session, DEFAULT_LARGE_PASSWORD)
    incidents = create_scoped_incidents_for_matrix(db_session, dataset)
    login_limiter.reset()

    def auth_header(token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    return client, db_session, dataset, incidents, auth_header


# ==============================================================================
# 1. Negative Tests for HTTP 401 (Unauthenticated & Session Revocation)
# ==============================================================================


def test_missing_authorization_header_returns_401_on_protected_endpoints(matrix_env):
    client, _, dataset, incidents, _ = matrix_env
    inc = incidents["facility_handler1"]

    protected_urls = [
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/auth/logout"),
        ("GET", "/api/v1/admin/users"),
        ("GET", f"/api/v1/incidents/{inc.id}"),
        ("GET", f"/api/v1/incidents/{inc.id}/comments"),
        ("POST", f"/api/v1/incidents/{inc.id}/comments"),
    ]

    for method, url in protected_urls:
        if method == "GET":
            resp = client.get(url)
        else:
            resp = client.post(url, json={})
        assert resp.status_code == 401, f"{method} {url} should return 401 without auth"
        body = resp.json()
        assert "error" in body
        assert body["error"]["code"] == "unauthenticated"
        assert "request_id" in body["error"]
        assert resp.headers.get("WWW-Authenticate") == "Bearer"


def test_malformed_and_non_bearer_schemes_return_401(matrix_env):
    client, _, _, _, _ = matrix_env
    malformed_headers = [
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "Token some-random-opaque-token"},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer    "},
        {"Authorization": "InvalidScheme randomtoken123"},
        {"Authorization": "Bearer fake.jwt.like.token.string.with.signature"},
    ]

    for header in malformed_headers:
        resp = client.get("/api/v1/auth/me", headers=header)
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "unauthenticated"


def test_expired_session_tokens_return_401_across_roles(matrix_env):
    client, _, dataset, _, auth_header = matrix_env
    roles_to_check = [
        "reporter@demo.invalid",
        "student.a@demo.invalid",
        "facility.handler1@demo.invalid",
        "facility.manager@demo.invalid",
        "admin@demo.invalid",
    ]

    for email in roles_to_check:
        expired_token = dataset.expired_tokens[email]
        resp = client.get("/api/v1/auth/me", headers=auth_header(expired_token))
        assert resp.status_code == 401, f"Expired token for {email} should return 401"
        assert resp.json()["error"]["code"] == "unauthenticated"


def test_revoked_session_tokens_return_401_across_roles(matrix_env):
    client, _, dataset, _, auth_header = matrix_env
    roles_to_check = [
        "reporter@demo.invalid",
        "student.a@demo.invalid",
        "electrical.handler1@demo.invalid",
        "electrical.manager@demo.invalid",
        "sec.admin@demo.invalid",
    ]

    for email in roles_to_check:
        revoked_token = dataset.revoked_tokens[email]
        resp = client.get("/api/v1/auth/me", headers=auth_header(revoked_token))
        assert resp.status_code == 401, f"Revoked token for {email} should return 401"
        assert resp.json()["error"]["code"] == "unauthenticated"


def test_locked_user_tokens_rejected_and_all_sessions_revoked(matrix_env):
    client, db_session, dataset, _, auth_header = matrix_env
    locked_emails = [
        "locked.reporter@demo.invalid",
        "locked.handler@demo.invalid",
        "locked.manager@demo.invalid",
        "locked.admin@demo.invalid",
    ]

    for email in locked_emails:
        user = dataset.users[email]
        token = dataset.locked_tokens[email]

        # Request with locked user token must return 401
        resp = client.get("/api/v1/auth/me", headers=auth_header(token))
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "unauthenticated"

        # Verify all sessions for this locked user are marked revoked in database
        sessions = db_session.scalars(
            select(UserSession).where(UserSession.user_id == user.id)
        ).all()
        for s in sessions:
            assert s.revoked_at is not None, (
                f"Session {s.id} for locked user {email} must be revoked"
            )


def test_admin_lock_user_immediately_invalidates_active_token(matrix_env):
    client, db_session, dataset, _, auth_header = matrix_env
    student_b = dataset.users["student.b@demo.invalid"]
    active_token = dataset.active_tokens["student.b@demo.invalid"]
    admin_token = dataset.active_tokens["admin@demo.invalid"]

    # 1. Before lock, student B can access /auth/me
    ok_resp = client.get("/api/v1/auth/me", headers=auth_header(active_token))
    assert ok_resp.status_code == 200
    assert ok_resp.json()["email"] == "student.b@demo.invalid"

    # 2. Admin locks student B via PATCH /api/v1/admin/users/{user_id}
    lock_resp = client.patch(
        f"/api/v1/admin/users/{student_b.id}",
        json={"is_active": False},
        headers=auth_header(admin_token),
    )
    assert lock_resp.status_code == 200
    assert lock_resp.json()["is_active"] is False

    # 3. Student B's active token must IMMEDIATELY return 401 on next request
    after_lock_resp = client.get("/api/v1/auth/me", headers=auth_header(active_token))
    assert after_lock_resp.status_code == 401
    assert after_lock_resp.json()["error"]["code"] == "unauthenticated"


def test_logout_revokes_only_calling_session(matrix_env):
    client, db_session, dataset, _, auth_header = matrix_env
    user = dataset.users["student.a@demo.invalid"]

    # Create two distinct active session tokens for the same user
    token1 = f"t1-{create_session_token()}"
    token2 = f"t2-{create_session_token()}"
    now = datetime.now(UTC)

    s1 = UserSession(
        user_id=user.id, token_hash=hash_session_token(token1), expires_at=now + timedelta(hours=4)
    )
    s2 = UserSession(
        user_id=user.id, token_hash=hash_session_token(token2), expires_at=now + timedelta(hours=4)
    )
    db_session.add_all([s1, s2])
    db_session.commit()

    # Both tokens work initially
    assert client.get("/api/v1/auth/me", headers=auth_header(token1)).status_code == 200
    assert client.get("/api/v1/auth/me", headers=auth_header(token2)).status_code == 200

    # Logout with token1
    logout_resp = client.post("/api/v1/auth/logout", headers=auth_header(token1))
    assert logout_resp.status_code == 204

    # token1 is now revoked -> 401
    assert client.get("/api/v1/auth/me", headers=auth_header(token1)).status_code == 401

    # token2 is still active and valid -> 200
    valid_resp = client.get("/api/v1/auth/me", headers=auth_header(token2))
    assert valid_resp.status_code == 200
    assert valid_resp.json()["email"] == "student.a@demo.invalid"


# ==============================================================================
# 2. Negative Tests for HTTP 404 (Record Scope & ID Guessing Prevention)
# ==============================================================================


def test_cross_reporter_access_hides_incident_with_404(matrix_env):
    client, _, dataset, incidents, auth_header = matrix_env
    inc_a = incidents["facility_handler1"]  # Reported by Student A
    tok_student_b = dataset.active_tokens["student.b@demo.invalid"]

    base = f"/api/v1/incidents/{inc_a.id}"

    # Student B cannot see or manipulate Student A's incident -> must be 404
    assert client.get(base, headers=auth_header(tok_student_b)).status_code == 404
    assert client.get(f"{base}/comments", headers=auth_header(tok_student_b)).status_code == 404
    assert (
        client.post(
            f"{base}/comments",
            json={
                "body": "B trying to comment on A's incident",
                "visibility": "public",
                "expected_version": 1,
            },
            headers=auth_header(tok_student_b),
        ).status_code
        == 404
    )
    assert client.get(f"{base}/history", headers=auth_header(tok_student_b)).status_code == 404
    assert (
        client.post(
            f"{base}/supplements",
            json={"text": "B trying to supplement A", "expected_version": 1},
            headers=auth_header(tok_student_b),
        ).status_code
        == 404
    )
    assert client.get(f"{base}/attachments", headers=auth_header(tok_student_b)).status_code == 404


def test_cross_department_staff_access_hides_incident_with_404(matrix_env):
    client, _, dataset, incidents, auth_header = matrix_env
    inc_facility = incidents["facility_handler1"]  # Department: Facility

    # Handlers & Managers from other departments must receive 404
    other_staff_tokens = [
        dataset.active_tokens["electrical.handler1@demo.invalid"],
        dataset.active_tokens["electrical.manager@demo.invalid"],
        dataset.active_tokens["it.manager@demo.invalid"],
        dataset.active_tokens["guard.captain@demo.invalid"],
    ]

    for token in other_staff_tokens:
        resp = client.get(f"/api/v1/incidents/{inc_facility.id}", headers=auth_header(token))
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "not_found"


def test_intra_department_unassigned_handler_access_hides_incident_with_404(matrix_env):
    client, _, dataset, incidents, auth_header = matrix_env
    # inc_facility is in Facility department, assigned to handler1
    inc_facility = incidents["facility_handler1"]
    # handler2 is also in Facility department, but NOT assigned to this incident
    tok_facility_handler2 = dataset.active_tokens["facility.handler2@demo.invalid"]

    # In policy: handler can only view incidents assigned to them (or reported by them)
    resp = client.get(
        f"/api/v1/incidents/{inc_facility.id}", headers=auth_header(tok_facility_handler2)
    )
    assert resp.status_code == 404


def test_non_existent_uuid_returns_404_with_standard_error_envelope(matrix_env):
    client, _, dataset, _, auth_header = matrix_env
    random_id = uuid4()
    tok_reporter = dataset.active_tokens["student.a@demo.invalid"]

    resp = client.get(f"/api/v1/incidents/{random_id}", headers=auth_header(tok_reporter))
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert "request_id" in body["error"]


# ==============================================================================
# 3. Negative Tests for HTTP 403 (Forbidden: Inside Scope but Disallowed Action)
# ==============================================================================


def test_reporter_forbidden_from_privileged_operations_on_own_incident(matrix_env):
    client, _, dataset, incidents, auth_header = matrix_env
    inc_a = incidents["facility_handler1"]
    tok_student_a = dataset.active_tokens["student.a@demo.invalid"]

    # Reporter owns inc_a, so GET succeeds
    assert (
        client.get(f"/api/v1/incidents/{inc_a.id}", headers=auth_header(tok_student_a)).status_code
        == 200
    )

    # 1. Reporter cannot post internal comments -> 403
    internal_comment_resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/comments",
        json={
            "body": "Reporter trying internal note",
            "visibility": "internal",
            "expected_version": 1,
        },
        headers=auth_header(tok_student_a),
    )
    assert internal_comment_resp.status_code == 403
    assert internal_comment_resp.json()["error"]["code"] == "forbidden"

    # 2. Reporter cannot transition workflow status -> 403
    transition_resp = client.post(
        f"/api/v1/incidents/{inc_a.id}/transitions",
        json={"expected_version": 1, "target_status": "closed", "reason": "Closing myself"},
        headers=auth_header(tok_student_a),
    )
    assert transition_resp.status_code == 403


def test_reporter_cannot_see_internal_comments_on_own_incident(matrix_env):
    client, _, dataset, incidents, auth_header = matrix_env
    inc_a = incidents["facility_handler1"]
    tok_student_a = dataset.active_tokens["student.a@demo.invalid"]
    tok_handler = dataset.active_tokens["facility.handler1@demo.invalid"]

    # Handler sees both public and internal comments (2 comments)
    handler_resp = client.get(
        f"/api/v1/incidents/{inc_a.id}/comments", headers=auth_header(tok_handler)
    )
    assert handler_resp.status_code == 200
    assert len(handler_resp.json()["items"]) == 2

    # Reporter sees ONLY public comment (1 comment, internal is stripped)
    reporter_resp = client.get(
        f"/api/v1/incidents/{inc_a.id}/comments", headers=auth_header(tok_student_a)
    )
    assert reporter_resp.status_code == 200
    comments = reporter_resp.json()["items"]
    assert len(comments) == 1
    assert comments[0]["visibility"] == "public"


def test_handler_forbidden_from_reassigning_or_closing_incident(matrix_env):
    client, _, dataset, incidents, auth_header = matrix_env
    inc_facility = incidents["facility_handler1"]
    tok_handler1 = dataset.active_tokens["facility.handler1@demo.invalid"]

    # Handler can view their assigned incident
    assert (
        client.get(
            f"/api/v1/incidents/{inc_facility.id}", headers=auth_header(tok_handler1)
        ).status_code
        == 200
    )

    # Handler cannot reassign -> 403
    reassign_resp = client.post(
        f"/api/v1/incidents/{inc_facility.id}/assign",
        json={
            "expected_version": 1,
            "department_id": str(inc_facility.department_id),
            "handler_id": str(dataset.users["facility.handler2@demo.invalid"].id),
            "reason": "Passing to colleague",
        },
        headers=auth_header(tok_handler1),
    )
    assert reassign_resp.status_code == 403

    # Handler cannot close incident (only manager or admin can close) -> 403
    # When incident is in 'resolved' status, handler trying to close gets 403 forbidden
    inc_facility.status = "resolved"
    matrix_env[1].commit()

    close_resp = client.post(
        f"/api/v1/incidents/{inc_facility.id}/transitions",
        json={
            "expected_version": 1,
            "target_status": "closed",
            "reason": "Handler closing directly",
        },
        headers=auth_header(tok_handler1),
    )
    assert close_resp.status_code == 403
    assert close_resp.json()["error"]["code"] == "forbidden"


def test_non_admin_roles_forbidden_from_admin_endpoints(matrix_env):
    client, _, dataset, _, auth_header = matrix_env
    non_admin_tokens = [
        ("reporter", dataset.active_tokens["student.a@demo.invalid"]),
        ("handler", dataset.active_tokens["facility.handler1@demo.invalid"]),
        ("manager", dataset.active_tokens["facility.manager@demo.invalid"]),
    ]

    for role_name, token in non_admin_tokens:
        resp_users = client.get("/api/v1/admin/users", headers=auth_header(token))
        assert resp_users.status_code == 403, f"{role_name} must receive 403 on /admin/users"
        assert resp_users.json()["error"]["code"] == "forbidden"

        resp_depts = client.get("/api/v1/admin/departments", headers=auth_header(token))
        assert resp_depts.status_code == 403, f"{role_name} must receive 403 on /admin/departments"


# ==============================================================================
# 4. Negative Tests for HTTP 429 (Rate Limiting)
# ==============================================================================


def test_login_rate_limiting_triggers_429_after_5_failures(matrix_env):
    client, _, _, _, _ = matrix_env
    email = "rate.test@demo.invalid"
    login_limiter.reset()

    # Attempts 1-5 return 401 invalid_credentials
    for i in range(5):
        resp = client.post(
            "/api/v1/auth/login", json={"email": email, "password": "WrongPassword123!"}
        )
        assert resp.status_code == 401, f"Attempt {i + 1} should return 401"
        assert resp.json()["error"]["code"] == "invalid_credentials"

    # 6th attempt must trigger 429 rate_limited
    blocked_resp = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "WrongPassword123!"}
    )
    assert blocked_resp.status_code == 429
    assert blocked_resp.json()["error"]["code"] == "rate_limited"
    assert "Retry-After" in blocked_resp.headers
    assert int(blocked_resp.headers["Retry-After"]) > 0
