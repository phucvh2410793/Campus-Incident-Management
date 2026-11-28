"""Week 10 (N1-W10) Security and Secret Audit Test Suite.

Validates:
- Token and Password Security: only cryptographic hashes in DB, never plaintext.
- API Response Safety: zero exposure of password_hash, token_hash, or secrets in API responses.
- Audit Log Sanitization: audit logs never capture passwords, tokens, or hashes.
- Log Redaction: headers and payloads mask Authorization and sensitive keys.
- Brute-Force & Rate Limiting Protection: account-isolated lockout.
- Source Code Repository Audit: zero hardcoded private keys or live secrets in Git.
"""

from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select

from app.admin.models import AdminAuditLog
from app.auth.models import Session as UserSession
from app.auth.rate_limit import login_limiter
from app.auth.seed_large import DEFAULT_LARGE_PASSWORD, seed_large_dataset
from app.core.logging_security import (
    redact_sensitive_data,
    redact_sensitive_headers,
)
from app.models import User


def test_database_stores_only_cryptographic_hashes_never_plaintext(db_session):
    dataset = seed_large_dataset(db_session, DEFAULT_LARGE_PASSWORD)

    # 1. Verify User passwords in DB
    users = db_session.scalars(select(User)).all()
    assert len(users) >= 20

    for user in users:
        # Must NOT equal plaintext password
        assert user.password_hash != DEFAULT_LARGE_PASSWORD
        assert DEFAULT_LARGE_PASSWORD not in user.password_hash
        # Must be valid Argon2id hash
        assert user.password_hash.startswith("$argon2id$") or user.password_hash.startswith(
            "$argon2"
        )

    # 2. Verify User Sessions in DB
    sessions = db_session.scalars(select(UserSession)).all()
    assert len(sessions) >= 40

    all_raw_tokens = set(dataset.active_tokens.values()) | set(dataset.expired_tokens.values())

    for sess in sessions:
        # token_hash must be 64-character hex string (SHA-256)
        assert len(sess.token_hash) == 64
        assert all(c in "0123456789abcdef" for c in sess.token_hash.lower())
        # Raw plaintext token must NEVER appear in DB
        assert sess.token_hash not in all_raw_tokens


def test_api_responses_never_expose_password_or_token_hashes(client, db_session):
    dataset = seed_large_dataset(db_session, DEFAULT_LARGE_PASSWORD)
    user = dataset.users["student.a@demo.invalid"]
    admin_token = dataset.active_tokens["admin@demo.invalid"]

    # 1. POST /auth/login response
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": DEFAULT_LARGE_PASSWORD},
    )
    assert login_resp.status_code == 200
    login_text = login_resp.text
    assert "password_hash" not in login_text
    assert "token_hash" not in login_text
    assert "$argon2" not in login_text

    # 2. GET /auth/me response
    me_resp = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {dataset.active_tokens['student.a@demo.invalid']}"},
    )
    assert me_resp.status_code == 200
    me_text = me_resp.text
    assert "password_hash" not in me_text
    assert "token_hash" not in me_text
    assert "$argon2" not in me_text

    # 3. GET /admin/users response
    admin_users_resp = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert admin_users_resp.status_code == 200
    admin_users_text = admin_users_resp.text
    assert "password_hash" not in admin_users_text
    assert "token_hash" not in admin_users_text
    assert "$argon2" not in admin_users_text


def test_admin_audit_logs_never_contain_passwords_or_session_hashes(client, db_session):
    dataset = seed_large_dataset(db_session, DEFAULT_LARGE_PASSWORD)
    admin_token = dataset.active_tokens["admin@demo.invalid"]

    test_password = "SuperSecretPassword123!"
    create_resp = client.post(
        "/api/v1/admin/users",
        json={
            "email": f"audit.test.{uuid4().hex[:8]}@demo.invalid",
            "display_name": "Audit Test User",
            "password": test_password,
            "role": "reporter",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert create_resp.status_code == 201
    created_id = UUID(create_resp.json()["id"])

    # Query audit logs from database directly
    audit_logs = db_session.scalars(
        select(AdminAuditLog).where(AdminAuditLog.target_id == created_id)
    ).all()
    assert len(audit_logs) >= 1

    for log in audit_logs:
        log_str = f"{log.before} {log.after}"
        # Plaintext password must NOT be in audit log
        assert test_password not in log_str
        # Hash must NOT be in audit log
        assert "password_hash" not in log_str
        assert "token_hash" not in log_str
        assert "$argon2" not in log_str


def test_logging_redaction_utilities_sanitize_headers_and_payloads():
    headers = {
        "Host": "api.example.com",
        "Authorization": "Bearer secret-session-token-xyz-12345",
        "Cookie": "session_id=abcdef123456",
        "User-Agent": "Mozilla/5.0",
        "X-Custom-Header": "SafeValue",
    }
    redacted_headers = redact_sensitive_headers(headers)
    assert redacted_headers["Authorization"] == "[REDACTED]"
    assert redacted_headers["Cookie"] == "[REDACTED]"
    assert redacted_headers["Host"] == "api.example.com"
    assert redacted_headers["User-Agent"] == "Mozilla/5.0"

    payload = {
        "username": "testuser",
        "password": "ClearTextPassword!",
        "profile": {
            "token": "sensitive-api-token",
            "theme": "dark",
        },
        "tags": ["safe", "normal"],
    }
    redacted_payload = redact_sensitive_data(payload)
    assert redacted_payload["username"] == "testuser"
    assert redacted_payload["password"] == "[REDACTED]"
    assert redacted_payload["profile"]["token"] == "[REDACTED]"
    assert redacted_payload["profile"]["theme"] == "dark"


def test_login_rate_limiter_isolates_accounts_and_resets_on_success():
    login_limiter.reset()

    user_a = "victim.a@demo.invalid"
    user_b = "innocent.b@demo.invalid"
    ip = "127.0.0.1"

    # User A receives 5 failures
    for _ in range(5):
        login_limiter.record_failure(user_a, ip)

    # User A is now rate-limited
    assert login_limiter.retry_after(user_a, ip) is not None

    # User B is NOT rate-limited (isolated by account pair)
    assert login_limiter.retry_after(user_b, ip) is None

    # Successful login for User A clears the failure counter
    login_limiter.clear(user_a, ip)
    assert login_limiter.retry_after(user_a, ip) is None


def test_repository_source_code_contains_no_hardcoded_private_keys_or_live_credentials():
    repo_root = Path(__file__).parents[2]

    # Patterns indicating high-risk leaked secrets
    forbidden_patterns = [
        "-----BEGIN RSA PRIVATE KEY-----",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "-----BEGIN EC PRIVATE KEY-----",
        "-----BEGIN PRIVATE KEY-----",
        "AKIA[0-9A-Z]{16}",  # AWS access key ID pattern
    ]

    extensions = {".py", ".ts", ".tsx", ".js", ".json", ".yaml", ".yml", ".md", ".sh"}
    checked_files = 0

    for path in repo_root.rglob("*"):
        if not path.is_file() or path.suffix not in extensions:
            continue
        if path.name == "test_n1_w10_security_audit.py":
            continue
        # Skip git directory, node_modules, and python venv
        parts = path.parts
        if any(
            ignored in parts for ignored in (".git", "node_modules", ".venv", "dist", "__pycache__")
        ):
            continue

        checked_files += 1
        content = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in forbidden_patterns:
            import re

            assert not re.search(pattern, content), f"Forbidden pattern '{pattern}' found in {path}"

    assert checked_files >= 50, f"Expected to audit at least 50 files, checked {checked_files}"
