from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.auth.models import Session as UserSession
from app.auth.security import hash_session_token
from app.models import User


def test_login_success(client, test_user):
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
    assert "expires_at" in data


def test_login_wrong_password(client, test_user):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": test_user.email,
            "password": "Wrong-password-123!",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_login_unknown_user(client):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "unknown-user@example.com",
            "password": "Test-password-123!",
        },
    )

    assert response.status_code == 401


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
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
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
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
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
        select(UserSession).where(
            UserSession.token_hash == hash_session_token(token)
        )
    )

    assert session is not None
    assert session.token_hash != token
