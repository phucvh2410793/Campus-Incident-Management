from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select

from app.auth.models import Session as UserSession
from app.auth.rate_limit import FailedLoginLimiter, login_limiter
from app.auth.security import hash_session_token


@pytest.fixture(autouse=True)
def reset_login_limiter():
    login_limiter.reset()
    yield
    login_limiter.reset()


def test_login_success(client, test_user):
    before_login = datetime.now(UTC)
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": test_user.email,
            "password": "Test-password-123!",
        },
    )

    assert response.status_code == 200

    data = response.json()
    assert data["token_type"] == "bearer"
    assert data["access_token"]
    assert (
        before_login + timedelta(hours=8)
        <= datetime.fromisoformat(data["expires_at"])
        <= datetime.now(UTC) + timedelta(hours=8)
    )
    assert data["user"] == {
        "id": str(test_user.id),
        "email": test_user.email,
        "display_name": test_user.display_name,
        "role": "reporter",
        "department_id": None,
        "is_active": True,
    }


def test_demo_invalid_domain_can_log_in(client, db_session, test_user):
    test_user.email = "reporter@demo.invalid"
    db_session.flush()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "Reporter@DEMO.INVALID", "password": "Test-password-123!"},
    )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == "reporter@demo.invalid"


def test_login_rejects_malformed_email(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "not-an-email", "password": "Test-password-123!"},
    )

    assert response.status_code == 422


def test_login_wrong_password(client, test_user):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": test_user.email,
            "password": "Wrong-password-123!",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"
    assert response.json()["error"]["message"] == "Email hoặc mật khẩu không đúng."
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]


def test_login_unknown_user(client):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "unknown-user@example.com",
            "password": "Test-password-123!",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"
    assert response.json()["error"]["message"] == "Email hoặc mật khẩu không đúng."


def test_login_rate_limit_blocks_sixth_attempt_even_with_correct_password(client, test_user):
    payload = {"email": test_user.email, "password": "Wrong-password-123!"}
    for _ in range(5):
        assert client.post("/api/v1/auth/login", json=payload).status_code == 401

    response = client.post(
        "/api/v1/auth/login",
        json={"email": test_user.email, "password": "Test-password-123!"},
    )
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"
    assert 1 <= int(response.headers["Retry-After"]) <= 900


def test_successful_login_clears_previous_failures(client, test_user):
    for _ in range(4):
        assert (
            client.post(
                "/api/v1/auth/login",
                json={"email": test_user.email, "password": "Wrong-password-123!"},
            ).status_code
            == 401
        )

    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": test_user.email, "password": "Test-password-123!"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": test_user.email, "password": "Wrong-password-123!"},
        ).status_code
        == 401
    )


def test_login_request_id_uses_valid_uuid_or_generates_one(client, test_user):
    supplied = "6b4b7899-080e-46d2-8a1a-f9cdf0942ab7"
    response = client.post(
        "/api/v1/auth/login",
        json={"email": test_user.email, "password": "Wrong-password-123!"},
        headers={"X-Request-ID": supplied},
    )
    assert response.headers["X-Request-ID"] == supplied
    assert response.json()["error"]["request_id"] == supplied

    response = client.post(
        "/api/v1/auth/login",
        json={"email": test_user.email, "password": "Wrong-password-123!"},
        headers={"X-Request-ID": "invalid"},
    )
    assert str(UUID(response.headers["X-Request-ID"])) == response.headers["X-Request-ID"]


def test_login_limit_is_scoped_to_email_and_ip_and_expires():
    now = [0.0]
    limiter = FailedLoginLimiter(clock=lambda: now[0])
    for _ in range(5):
        limiter.record_failure("a@example.com", "192.0.2.1")

    assert limiter.retry_after("a@example.com", "192.0.2.1") == 900
    assert limiter.retry_after("b@example.com", "192.0.2.1") is None
    assert limiter.retry_after("a@example.com", "192.0.2.2") is None

    now[0] = 900.0
    assert limiter.retry_after("a@example.com", "192.0.2.1") is None


def test_me_without_token(client):
    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401


def test_me_with_valid_token(client, auth_headers, test_user):
    response = client.get(
        "/api/v1/auth/me",
        headers=auth_headers,
    )

    assert response.status_code == 200

    data = response.json()
    assert data["email"] == test_user.email
    assert data["role"] == "reporter"
    assert data["is_active"] is True


def test_me_with_invalid_token(client):
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 401


def test_logout_revokes_token(client, auth_headers):
    response = client.post(
        "/api/v1/auth/logout",
        headers=auth_headers,
    )

    assert response.status_code == 204

    response_after_logout = client.get(
        "/api/v1/auth/me",
        headers=auth_headers,
    )

    assert response_after_logout.status_code == 401


def test_inactive_user_cannot_login(client, db_session, test_user):
    test_user.is_active = False
    db_session.flush()

    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": test_user.email,
            "password": "Test-password-123!",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_credentials"
    assert response.json()["error"]["message"] == "Email hoặc mật khẩu không đúng."


def test_expired_session_is_rejected(
    client,
    db_session,
    test_user,
):
    from app.auth.security import create_session_token

    token = create_session_token()

    session = UserSession(
        user_id=test_user.id,
        token_hash=hash_session_token(token),
        expires_at=datetime.now(UTC) - timedelta(hours=1),
    )

    db_session.add(session)
    db_session.flush()

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401


def test_inactive_user_cannot_use_existing_token(
    client,
    db_session,
    test_user,
):
    from app.auth.security import create_session_token

    token = create_session_token()

    session = UserSession(
        user_id=test_user.id,
        token_hash=hash_session_token(token),
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )

    db_session.add(session)
    test_user.is_active = False
    db_session.flush()

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401


def test_login_does_not_return_password_hash(client, test_user):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": test_user.email,
            "password": "Test-password-123!",
        },
    )

    assert response.status_code == 200
    assert "password_hash" not in response.text
    assert "Test-password-123!" not in response.text


def test_session_stores_token_hash_not_plaintext(
    client,
    db_session,
    test_user,
):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": test_user.email,
            "password": "Test-password-123!",
        },
    )

    assert response.status_code == 200

    token = response.json()["access_token"]

    session = db_session.scalar(
        select(UserSession).where(UserSession.token_hash == hash_session_token(token))
    )

    assert session is not None
    assert session.token_hash != token
