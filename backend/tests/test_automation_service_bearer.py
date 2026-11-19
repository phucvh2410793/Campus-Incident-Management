import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_db
from app.auth.models import Session as UserSession
from app.automation.fixtures import SAMPLE_INCIDENT_ID, SAMPLE_REQUEST_ID
from app.automation.models import Notification, OutboxEvent
from app.automation.publisher import InMemoryEventPublisher, set_event_publisher
from app.automation.repository import NotificationRepository, OutboxRepository
from app.automation.router import _IN_MEMORY_EVALUATIONS
from app.automation.schemas import EventEnvelope, EventType
from app.automation.security import (
    DEFAULT_WEBHOOK_SECRET,
    build_webhook_headers,
    verify_webhook_request,
)
from app.automation.service_auth import (
    DEFAULT_DEMO_SERVICE_TOKEN,
    clear_test_user_tokens,
    get_optional_db,
    hash_service_token,
    is_user_token,
    token_manager,
)
from app.main import app

VALID_SERVICE_TOKEN = DEFAULT_DEMO_SERVICE_TOKEN


@pytest.fixture
def test_engine():
    """Create a thread-safe in-memory SQLite engine with fresh schema."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    UserSession.__table__.create(engine)
    OutboxEvent.__table__.create(engine)
    Notification.__table__.create(engine)
    yield engine
    Notification.__table__.drop(engine)
    OutboxEvent.__table__.drop(engine)
    UserSession.__table__.drop(engine)


@pytest.fixture
def session_factory(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture
def db_session(session_factory):
    with session_factory() as session:
        yield session


@pytest.fixture(autouse=True)
def reset_automation_state():
    """Reset service token manager, user token test registry, and publisher before each test."""
    token_manager.reset()
    clear_test_user_tokens()
    _IN_MEMORY_EVALUATIONS.clear()
    publisher = InMemoryEventPublisher()
    set_event_publisher(publisher)
    yield
    token_manager.reset()
    clear_test_user_tokens()
    _IN_MEMORY_EVALUATIONS.clear()


@pytest.fixture
def client(session_factory):
    """TestClient that creates thread-safe sessions from session_factory for get_optional_db."""

    def override_get_optional_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_optional_db] = override_get_optional_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_optional_db, None)


# ---------------------------------------------------------------------------
# 1. Service Bearer Authentication & User Token Rejection Tests
# ---------------------------------------------------------------------------


def test_internal_endpoint_rejects_missing_authorization(client: TestClient):
    """Calling /internal/* without Authorization header must return 401 Unauthorized."""
    event_id = uuid.uuid4()
    response = client.get(f"/internal/events/{event_id}")
    assert response.status_code == 401
    assert "WWW-Authenticate" in response.headers
    assert response.json()["detail"] == "Service bearer token required"


def test_internal_endpoint_rejects_non_bearer_scheme(client: TestClient):
    """Calling /internal/* with Basic or other non-Bearer schemes must return 401 Unauthorized."""
    event_id = uuid.uuid4()
    response = client.get(
        f"/internal/events/{event_id}",
        headers={"Authorization": "Basic dXNlcjpwYXNz"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Service bearer token required"


def test_internal_endpoint_rejects_empty_bearer_token(client: TestClient):
    """Empty or whitespace-only bearer token must be rejected with 401."""
    event_id = uuid.uuid4()
    response = client.get(
        f"/internal/events/{event_id}",
        headers={"Authorization": "Bearer "},
    )
    assert response.status_code == 401
    assert "empty" in response.json()["detail"] or "required" in response.json()["detail"]


def test_internal_endpoint_rejects_invalid_service_token(client: TestClient):
    """Unrecognized service bearer token must return 401 with WWW-Authenticate error."""
    event_id = uuid.uuid4()
    response = client.get(
        f"/internal/events/{event_id}",
        headers={"Authorization": "Bearer completely-bogus-token-xyz"},
    )
    assert response.status_code == 401
    assert "invalid_token" in response.headers.get("WWW-Authenticate", "")


def test_internal_endpoint_strictly_rejects_user_token(client: TestClient, db_session: Session):
    """A user session token MUST NOT be permitted to access /internal/* endpoints (403 Forbidden).

    Contract requirement: 'User token không gọi internal'.
    Verified against both DB session lookup and in-memory registry.
    """
    user_token = "user-session-token-abc123xyz"
    user_token_hash = hash_service_token(user_token)

    # Insert valid user session into test database
    user_session = UserSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        token_hash=user_token_hash,
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    db_session.add(user_session)
    db_session.commit()

    assert is_user_token(user_token, db=db_session)

    event_id = uuid.uuid4()
    response = client.get(
        f"/internal/events/{event_id}",
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert response.status_code == 403
    expected_msg = "User tokens are not permitted to access internal endpoints"
    assert response.json()["detail"] == expected_msg


def test_internal_endpoint_accepts_valid_service_bearer_token(
    client: TestClient, db_session: Session
):
    """Valid service token authorizes access to /internal/* endpoints."""
    event_id = uuid.uuid4()
    repo = OutboxRepository(db_session)
    envelope = EventEnvelope(
        event_id=event_id,
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    repo.save_event(envelope)
    db_session.commit()

    response = client.get(
        f"/internal/events/{event_id}",
        headers={"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["event_id"] == str(event_id)
    assert data["event_type"] == "incident.reported"
    assert data["status"] == "pending"


def test_service_bearer_token_rotation_allows_seamless_transition(client: TestClient):
    """Token rotation supports multiple active token hashes simultaneously.

    When rotating:
    - Primary token A and Secondary token B are both valid.
    - Revoking token A rejects token A while token B remains valid.
    """
    token_old = "service-token-version-1"
    token_new = "service-token-version-2"

    hash_old = token_manager.register_service_token(token_old)
    _ = token_manager.register_service_token(token_new)

    headers_old = {"Authorization": f"Bearer {token_old}"}
    headers_new = {"Authorization": f"Bearer {token_new}"}

    # Both tokens are authorized
    resp_old = client.post("/internal/sla/check", headers=headers_old)
    assert resp_old.status_code == 200

    resp_new = client.post("/internal/sla/check", headers=headers_new)
    assert resp_new.status_code == 200

    # Revoke old token
    revoked = token_manager.revoke_token_hash(hash_old)
    assert revoked is True

    # Old token is now rejected
    resp_old_revoked = client.post("/internal/sla/check", headers=headers_old)
    assert resp_old_revoked.status_code == 401

    # New token remains authorized
    resp_new_active = client.post("/internal/sla/check", headers=headers_new)
    assert resp_new_active.status_code == 200


def test_service_token_only_stored_as_sha256_hash():
    """Service bearer tokens must only be held in hashed format, never plaintext."""
    raw_token = "my-super-secret-service-token-123"
    token_hash = hash_service_token(raw_token)
    assert len(token_hash) == 64
    assert raw_token not in token_manager.get_active_hashes()

    token_manager.register_service_token(raw_token)
    assert token_hash in token_manager.get_active_hashes()
    assert token_manager.is_valid_service_token(raw_token)
    assert not token_manager.is_valid_service_token("wrong-token")


# ---------------------------------------------------------------------------
# 2. HMAC Timestamp and Event ID Outside Git Tests
# ---------------------------------------------------------------------------


def test_hmac_signature_verification_success_within_tolerance():
    """Correct signature with timestamp within 300s tolerance is verified successfully."""
    event_id = uuid.uuid4()
    body = '{"event_id":"' + str(event_id) + '"}'
    secret = "production-secret-outside-git"
    now = int(time.time())

    headers = build_webhook_headers(event_id, body, secret, timestamp=now)
    result = verify_webhook_request(headers, body, secret, current_time=now)

    assert result.is_valid is True
    assert result.error_code is None
    assert result.event_id == event_id
    assert result.timestamp == now


def test_hmac_signature_rejected_when_corrupted():
    """Wrong signature or tampered body must be rejected with invalid_signature."""
    event_id = uuid.uuid4()
    body = '{"event_id":"' + str(event_id) + '"}'
    secret = "production-secret-outside-git"
    now = int(time.time())

    headers = build_webhook_headers(event_id, body, secret, timestamp=now)
    # Tamper signature
    headers["X-CIM-Signature"] = "sha256=" + "0" * 64

    result = verify_webhook_request(headers, body, secret, current_time=now)
    assert result.is_valid is False
    assert result.error_code == "invalid_signature"


def test_hmac_timestamp_expired_rejected():
    """Timestamp older than 300 seconds must be rejected with expired_timestamp.

    Contract requirement: 'signature sai/quá hạn bị từ chối'.
    """
    event_id = uuid.uuid4()
    body = '{"event_id":"' + str(event_id) + '"}'
    secret = "production-secret-outside-git"
    now = int(time.time())
    old_timestamp = now - 301  # Exceeded 300s tolerance by 1 second

    headers = build_webhook_headers(event_id, body, secret, timestamp=old_timestamp)
    result = verify_webhook_request(headers, body, secret, current_time=now)

    assert result.is_valid is False
    assert result.error_code == "expired_timestamp"
    assert "quá hạn" in (result.error_message or "")


def test_hmac_timestamp_future_skew_rejected():
    """Timestamp skewed more than 300 seconds into the future must be rejected."""
    event_id = uuid.uuid4()
    body = '{"event_id":"' + str(event_id) + '"}'
    secret = "production-secret-outside-git"
    now = int(time.time())
    future_timestamp = now + 305  # Exceeded future tolerance

    headers = build_webhook_headers(event_id, body, secret, timestamp=future_timestamp)
    result = verify_webhook_request(headers, body, secret, current_time=now)

    assert result.is_valid is False
    assert result.error_code == "future_timestamp"


def test_hmac_missing_headers_rejected():
    """Missing any of Event-ID, Timestamp, or Signature headers must be rejected."""
    body = "{}"
    result = verify_webhook_request({}, body, "secret")
    assert result.is_valid is False
    assert result.error_code == "missing_headers"


def test_hmac_invalid_event_id_rejected():
    """Malformed UUID in X-CIM-Event-ID must be rejected."""
    headers = {
        "X-CIM-Event-ID": "not-a-uuid",
        "X-CIM-Timestamp": "1730000000",
        "X-CIM-Signature": "sha256=123",
    }
    result = verify_webhook_request(headers, "{}", "secret")
    assert result.is_valid is False
    assert result.error_code == "invalid_event_id"


def test_hmac_secret_rotation_supports_multiple_keys():
    """Incoming webhooks signed with old or new secret are both verified during rotation."""
    old_secret = "old-webhook-secret-phase-out"
    new_secret = "new-webhook-secret-active"
    secrets_rotation = [old_secret, new_secret]

    event_id = uuid.uuid4()
    body = '{"event_id":"' + str(event_id) + '"}'
    now = int(time.time())

    # Sign with old secret
    headers_signed_with_old = build_webhook_headers(event_id, body, old_secret, timestamp=now)
    res_old = verify_webhook_request(
        headers_signed_with_old, body, secrets_rotation, current_time=now
    )
    assert res_old.is_valid is True

    # Sign with new secret
    headers_signed_with_new = build_webhook_headers(event_id, body, new_secret, timestamp=now)
    res_new = verify_webhook_request(
        headers_signed_with_new, body, secrets_rotation, current_time=now
    )
    assert res_new.is_valid is True

    # Sign with third unregistered secret -> must fail
    headers_unregistered = build_webhook_headers(event_id, body, "unregistered-key", timestamp=now)
    res_unregistered = verify_webhook_request(
        headers_unregistered, body, secrets_rotation, current_time=now
    )
    assert res_unregistered.is_valid is False
    assert res_unregistered.error_code == "invalid_signature"


# ---------------------------------------------------------------------------
# 3. /internal/* Endpoints API Contract Tests
# ---------------------------------------------------------------------------


def test_get_internal_event_metadata_does_not_leak_sensitive_fields(
    client: TestClient, db_session: Session
):
    """GET /internal/events/{id} returns minimal envelope metadata and no sensitive payload."""
    event_id = uuid.uuid4()
    repo = OutboxRepository(db_session)
    envelope = EventEnvelope(
        event_id=event_id,
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    repo.save_event(envelope)
    db_session.commit()

    response = client.get(
        f"/internal/events/{event_id}",
        headers={"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"},
    )
    assert response.status_code == 200
    data = response.json()

    # Required fields
    assert "event_id" in data
    assert "event_type" in data
    assert "incident_id" in data
    assert "status" in data

    # Forbidden sensitive fields per API contract
    assert "description" not in data
    assert "evidence" not in data
    assert "password" not in data
    assert "notes" not in data


def test_get_internal_event_not_found(client: TestClient):
    """GET /internal/events/{id} for non-existent event returns 404."""
    random_id = uuid.uuid4()
    response = client.get(
        f"/internal/events/{random_id}",
        headers={"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"},
    )
    assert response.status_code == 404


def test_evaluate_internal_event_idempotent(client: TestClient, db_session: Session):
    """POST /internal/events/{id}/evaluate returns evaluation result and is idempotent."""
    event_id = uuid.uuid4()
    repo = OutboxRepository(db_session)
    envelope = EventEnvelope(
        event_id=event_id,
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    repo.save_event(envelope)
    db_session.commit()

    headers = {"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"}
    body = {"run_id": "n8n-run-001"}

    # First evaluation
    res1 = client.post(f"/internal/events/{event_id}/evaluate", json=body, headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["status"] == "assigned"
    assert data1["rule_id"] == "demo-v1"
    assert data1["incident_id"] == str(SAMPLE_INCIDENT_ID)

    # Second evaluation must return identical result (idempotent)
    res2 = client.post(
        f"/internal/events/{event_id}/evaluate",
        json={"run_id": "n8n-run-002"},
        headers=headers,
    )
    assert res2.status_code == 200
    assert res2.json() == data1


def test_evaluate_internal_event_not_found(client: TestClient):
    """POST /internal/events/{id}/evaluate for non-existent event returns 404."""
    random_id = uuid.uuid4()
    response = client.post(
        f"/internal/events/{random_id}/evaluate",
        json={"run_id": "run-1"},
        headers={"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"},
    )
    assert response.status_code == 404


def test_complete_internal_event(client: TestClient, db_session: Session):
    """POST /internal/events/{id}/complete marks event as done."""
    event_id = uuid.uuid4()
    repo = OutboxRepository(db_session)
    envelope = EventEnvelope(
        event_id=event_id,
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    repo.save_event(envelope)
    db_session.commit()

    response = client.post(
        f"/internal/events/{event_id}/complete",
        json={"run_id": "run-001", "status": "done"},
        headers={"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "done"


def test_complete_guards_done_to_failed(client: TestClient, db_session: Session):
    """Complete event guards against done -> failed transition (API contract)."""
    event_id = uuid.uuid4()
    repo = OutboxRepository(db_session)
    envelope = EventEnvelope(
        event_id=event_id,
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    repo.save_event(envelope)
    db_session.commit()

    headers = {"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"}

    # 1. Complete with status='done'
    res_done = client.post(
        f"/internal/events/{event_id}/complete",
        json={"run_id": "run-001", "status": "done"},
        headers=headers,
    )
    assert res_done.status_code == 200
    assert res_done.json()["status"] == "done"

    # 2. Complete again with status='done' -> idempotent 200
    res_done_again = client.post(
        f"/internal/events/{event_id}/complete",
        json={"run_id": "run-002", "status": "done"},
        headers=headers,
    )
    assert res_done_again.status_code == 200

    # 3. Transition from done -> failed must be blocked with 409 Conflict
    res_conflict = client.post(
        f"/internal/events/{event_id}/complete",
        json={"run_id": "run-003", "status": "failed", "error_code": "ERR_RETRY"},
        headers=headers,
    )
    assert res_conflict.status_code == 409
    assert "cannot be marked 'failed'" in res_conflict.json()["detail"]


def test_claim_internal_notification(client: TestClient):
    """POST /internal/notifications/claim claims notification task."""
    event_id = uuid.uuid4()
    recipient_id = uuid.uuid4()

    response = client.post(
        "/internal/notifications/claim",
        json={
            "event_id": str(event_id),
            "kind": "incident_reported",
            "recipient_user_id": str(recipient_id),
        },
        headers={"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "notification_id" in data
    assert "should_send" in data


def test_complete_internal_notification(client: TestClient, db_session: Session):
    """POST /internal/notifications/{id}/complete records delivery status."""
    event_id = uuid.uuid4()
    recipient_id = uuid.uuid4()
    repo = NotificationRepository(db_session)
    notif, _ = repo.claim_notification(event_id, "test_kind", recipient_id)
    db_session.commit()

    response = client.post(
        f"/internal/notifications/{notif.id}/complete",
        json={
            "status": "sent",
            "provider_message_id": "smtp-msg-12345",
        },
        headers={"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["notification_id"] == str(notif.id)
    assert data["status"] == "sent"


def test_sla_check_endpoint(client: TestClient):
    """POST /internal/sla/check returns checked and escalation counts."""
    response = client.post(
        "/internal/sla/check",
        headers={"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "checked_count" in data
    assert "escalations_created" in data


def test_service_token_cannot_access_user_endpoint(client: TestClient, session_factory):
    """A service bearer token cannot be used to authenticate as a user on /api/v1/auth/me."""

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"},
        )
        assert response.status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_webhook_verify_endpoint_success_and_failure(client: TestClient):
    """POST /internal/webhooks/verify tests webhook verification dependency."""
    event_id = uuid.uuid4()
    body = '{"event_id":"' + str(event_id) + '"}'
    now = int(time.time())

    # 1. Valid signature and timestamp
    headers = build_webhook_headers(event_id, body, DEFAULT_WEBHOOK_SECRET, timestamp=now)
    headers["Authorization"] = f"Bearer {VALID_SERVICE_TOKEN}"

    res_ok = client.post(
        "/internal/webhooks/verify",
        content=body,
        headers=headers,
    )
    assert res_ok.status_code == 200
    assert res_ok.json()["status"] == "verified"
    assert res_ok.json()["event_id"] == str(event_id)

    # 2. Expired timestamp (> 300s)
    headers_expired = build_webhook_headers(
        event_id, body, DEFAULT_WEBHOOK_SECRET, timestamp=now - 350
    )
    headers_expired["Authorization"] = f"Bearer {VALID_SERVICE_TOKEN}"
    res_expired = client.post(
        "/internal/webhooks/verify",
        content=body,
        headers=headers_expired,
    )
    assert res_expired.status_code == 401
    assert "quá hạn" in res_expired.json()["detail"]
