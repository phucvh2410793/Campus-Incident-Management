"""Tests for N5 W6 & W7: Notification Claim, Email Dispatch, and Uncertain Handling.

Acceptance criteria:
- W6: Gửi đúng người/link; không gửi file, secret hoặc ghi chú internal.
- W7: Lỗi giữa chừng truy vết được; uncertain không tự gửi lại.
"""

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.models import Session as UserSession
from app.automation.fixtures import SAMPLE_INCIDENT_ID, SAMPLE_REQUEST_ID
from app.automation.models import Notification, OutboxEvent
from app.automation.notifications import (
    DemoEmailSender,
    NotificationEmail,
    NotificationKind,
    NotificationSecurityError,
    build_assigned_notification,
    build_p1_alert_notification,
    build_reported_notification,
    demo_email_sender,
    dispatch_notification_task,
    validate_notification_safety,
)
from app.automation.publisher import InMemoryEventPublisher, set_event_publisher
from app.automation.repository import NotificationRepository, OutboxRepository
from app.automation.run_worker import main as run_worker_main
from app.automation.schemas import EventEnvelope, EventType
from app.automation.service_auth import (
    DEFAULT_DEMO_SERVICE_TOKEN,
    clear_test_user_tokens,
    get_optional_db,
    token_manager,
)
from app.automation.webhook import DispatchResult
from app.automation.worker import OutboxWorkerStub
from app.main import app

VALID_SERVICE_TOKEN = DEFAULT_DEMO_SERVICE_TOKEN
SERVICE_HEADERS = {"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"}

REPORTER_USER_ID = uuid.UUID("10000000-0000-4000-8000-000000000001")
REPORTER_EMAIL = "reporter@demo.invalid"
HANDLER_USER_ID = uuid.UUID("10000000-0000-4000-8000-000000000002")
HANDLER_EMAIL = "handler@demo.invalid"
MANAGER_USER_ID = uuid.UUID("10000000-0000-4000-8000-000000000003")
MANAGER_EMAIL = "manager@demo.invalid"


@pytest.fixture(autouse=True)
def reset_singletons(monkeypatch):
    monkeypatch.setenv("CIM_WEBHOOK_HMAC_SECRET", "test-secret-w6w7")
    monkeypatch.delenv("CIM_WEBHOOK_HMAC_SECRETS_ROTATION", raising=False)
    monkeypatch.delenv("CIM_INTERNAL_SERVICE_BEARER_TOKENS", raising=False)
    monkeypatch.delenv("CIM_INTERNAL_SERVICE_TOKEN_HASHES", raising=False)

    token_manager.reset()
    clear_test_user_tokens()
    demo_email_sender.clear()
    set_event_publisher(InMemoryEventPublisher())
    yield
    token_manager.reset()
    clear_test_user_tokens()
    demo_email_sender.clear()


@pytest.fixture
def test_engine():
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


@pytest.fixture
def client(session_factory):
    def override_get_optional_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_optional_db] = override_get_optional_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_optional_db, None)


# ===========================================================================
# 1. W6 TESTS: Notification Formatting, Safe Links, and Security Policy
# ===========================================================================


def test_build_reported_notification_recipient_and_link():
    """Reporter receives confirmation with tracking link; no files, secrets, or internal notes."""
    incident_id = uuid.uuid4()
    email = build_reported_notification(
        incident_id=incident_id,
        reporter_user_id=REPORTER_USER_ID,
        reporter_email=REPORTER_EMAIL,
        category="rò nước",
        frontend_base_url="http://localhost:5173",
    )

    assert email.recipient_user_id == REPORTER_USER_ID
    assert email.recipient_email == REPORTER_EMAIL
    assert email.kind == NotificationKind.INCIDENT_REPORTED
    assert str(incident_id)[:8] in email.subject
    # Verify proper public reporter link
    expected_link = f"http://localhost:5173/incidents/{incident_id}"
    assert email.link == expected_link
    assert expected_link in email.body_text

    # Security verification
    validate_notification_safety(email)


def test_build_assigned_notification_recipient_and_link():
    """Handler receives assignment with staff management link; no files or secrets."""
    incident_id = uuid.uuid4()
    email = build_assigned_notification(
        incident_id=incident_id,
        handler_user_id=HANDLER_USER_ID,
        handler_email=HANDLER_EMAIL,
        department_name="Cơ sở vật chất",
        priority="P2",
        frontend_base_url="http://localhost:5173",
    )

    assert email.recipient_user_id == HANDLER_USER_ID
    assert email.recipient_email == HANDLER_EMAIL
    assert email.kind == NotificationKind.INCIDENT_ASSIGNED
    assert str(incident_id)[:8] in email.subject
    # Verify proper staff link
    expected_link = f"http://localhost:5173/staff/incidents/{incident_id}"
    assert email.link == expected_link
    assert expected_link in email.body_text
    assert "Cơ sở vật chất" in email.body_text

    # Security verification
    validate_notification_safety(email)


def test_build_p1_alert_notification_recipient_and_link():
    """Manager receives P1 alert with deadline and link; no files or secrets."""
    incident_id = uuid.uuid4()
    deadline = datetime(2026, 11, 20, 10, 30, 0, tzinfo=UTC)
    email = build_p1_alert_notification(
        incident_id=incident_id,
        manager_user_id=MANAGER_USER_ID,
        manager_email=MANAGER_EMAIL,
        reason="Rò rỉ nước gần tủ điện chính gây nguy cơ chập cháy",
        deadline=deadline,
        frontend_base_url="http://localhost:5173",
    )

    assert email.recipient_user_id == MANAGER_USER_ID
    assert email.recipient_email == MANAGER_EMAIL
    assert email.kind == NotificationKind.P1_ALERT
    assert "KHẨN CẤP" in email.subject
    assert "P1" in email.subject
    expected_link = f"http://localhost:5173/staff/incidents/{incident_id}"
    assert email.link == expected_link
    assert expected_link in email.body_text
    assert "nguy cơ chập cháy" in email.body_text

    # Security verification
    validate_notification_safety(email)


@pytest.mark.parametrize(
    "prohibited_snippet",
    [
        "User password: SuperSecretPassword123!",
        "password_hash: $argon2id$v=19$m=65536,t=3,p=4$abc",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token",
        "Your access_token is 987654321",
        "client_secret = secret_key_value",
        "CIM_WEBHOOK_HMAC_SECRET = my_secret",
    ],
)
def test_notification_safety_rejects_raw_secrets(prohibited_snippet: str):
    """Notification emails MUST NEVER leak passwords, session tokens, or API secrets."""
    incident_id = uuid.uuid4()
    leaky_email = NotificationEmail(
        recipient_user_id=REPORTER_USER_ID,
        recipient_email=REPORTER_EMAIL,
        subject="Incident update",
        body_text=f"Please review: {prohibited_snippet}",
        link=f"http://localhost:5173/incidents/{incident_id}",
        kind=NotificationKind.INCIDENT_REPORTED,
        incident_id=incident_id,
    )
    with pytest.raises(NotificationSecurityError, match="Prohibited secret pattern detected"):
        validate_notification_safety(leaky_email)


@pytest.mark.parametrize(
    "prohibited_snippet",
    [
        "Attached evidence: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8",
        "Raw payload base64,aW1wb3J0YW50ZmlsZWRhdGFiYXNlNjRiaW5hcnk=",
        "Download file at https://api.cim/attachments/12345/download?token=secret",
        "File attachment_id: 3fa85f64-5717-4562-b3fc-2c963f66afa6",
    ],
)
def test_notification_safety_rejects_file_attachments(prohibited_snippet: str):
    """Notification emails MUST NEVER attach files or signed file download tokens."""
    incident_id = uuid.uuid4()
    leaky_email = NotificationEmail(
        recipient_user_id=REPORTER_USER_ID,
        recipient_email=REPORTER_EMAIL,
        subject="Incident report",
        body_text=f"Incident details with {prohibited_snippet}",
        link=f"http://localhost:5173/incidents/{incident_id}",
        kind=NotificationKind.INCIDENT_REPORTED,
        incident_id=incident_id,
    )
    with pytest.raises(NotificationSecurityError, match="Prohibited file/binary pattern detected"):
        validate_notification_safety(leaky_email)


@pytest.mark.parametrize(
    "prohibited_snippet",
    [
        "[internal] Note from technician: suspected equipment tampering",
        "Ghi chú nội bộ: Cần chuyển sang công an điều tra",
        "internal_note = Check suspect's prior history",
        "visibility: internal - do not show to student",
        "is_internal: true",
    ],
)
def test_notification_safety_rejects_internal_notes(prohibited_snippet: str):
    """Notification emails MUST NEVER contain internal staff notes or triage-only comments."""
    incident_id = uuid.uuid4()
    leaky_email = NotificationEmail(
        recipient_user_id=REPORTER_USER_ID,
        recipient_email=REPORTER_EMAIL,
        subject="Update on your report",
        body_text=f"Incident status: in progress. {prohibited_snippet}",
        link=f"http://localhost:5173/incidents/{incident_id}",
        kind=NotificationKind.INCIDENT_REPORTED,
        incident_id=incident_id,
    )
    with pytest.raises(NotificationSecurityError, match="Prohibited internal note detected"):
        validate_notification_safety(leaky_email)


# ===========================================================================
# 2. W6 TESTS: Atomic Claim Idempotency & Email Delivery Workflow
# ===========================================================================


def test_dispatch_notification_task_full_flow(db_session: Session):
    """Test atomic claim -> validate -> send -> complete flow."""
    event_id = uuid.uuid4()
    incident_id = uuid.uuid4()
    email = build_reported_notification(
        incident_id=incident_id,
        reporter_user_id=REPORTER_USER_ID,
        reporter_email=REPORTER_EMAIL,
    )

    sender = DemoEmailSender()
    notif, result, was_newly_sent = dispatch_notification_task(
        db=db_session,
        event_id=event_id,
        email=email,
        sender=sender,
    )

    assert was_newly_sent is True
    assert notif.status == "sent"
    assert notif.provider_message_id is not None
    assert len(sender.sent_emails) == 1
    assert sender.sent_emails[0].recipient_email == REPORTER_EMAIL


def test_notification_claim_idempotency_prevents_duplicate_sending(db_session: Session):
    """Claim key (event_id, kind, recipient_user_id) prevents sending duplicate emails on retry."""
    event_id = uuid.uuid4()
    incident_id = uuid.uuid4()
    email = build_reported_notification(
        incident_id=incident_id,
        reporter_user_id=REPORTER_USER_ID,
        reporter_email=REPORTER_EMAIL,
    )

    sender = DemoEmailSender()

    # First dispatch attempt: claims and sends email
    notif1, result1, was_newly_sent1 = dispatch_notification_task(
        db=db_session, event_id=event_id, email=email, sender=sender
    )
    assert was_newly_sent1 is True
    assert result1.status == "sent"
    assert len(sender.sent_emails) == 1

    # Second dispatch attempt with same event and recipient (e.g. n8n replay or retry)
    notif2, result2, was_newly_sent2 = dispatch_notification_task(
        db=db_session, event_id=event_id, email=email, sender=sender
    )
    assert was_newly_sent2 is False
    assert notif2.id == notif1.id
    # Crucial assertion: email sender was NOT called a second time
    assert len(sender.sent_emails) == 1


def test_dispatch_notification_endpoint_api(client: TestClient, db_session: Session):
    """Test POST /internal/notifications/dispatch HTTP endpoint."""
    event_id = uuid.uuid4()
    incident_id = uuid.uuid4()

    payload = {
        "event_id": str(event_id),
        "scenario": "reported",
        "recipient_user_id": str(REPORTER_USER_ID),
        "recipient_email": REPORTER_EMAIL,
        "incident_id": str(incident_id),
        "category": "nguy hiểm điện",
    }

    response = client.post(
        "/internal/notifications/dispatch",
        json=payload,
        headers=SERVICE_HEADERS,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "sent"
    assert data["was_newly_sent"] is True
    assert data["recipient_email"] == REPORTER_EMAIL
    assert f"/incidents/{incident_id}" in data["link"]
    assert data["provider_message_id"] is not None

    # Calling again with identical parameters returns was_newly_sent = False
    dup_res = client.post(
        "/internal/notifications/dispatch",
        json=payload,
        headers=SERVICE_HEADERS,
    )
    assert dup_res.status_code == 200
    assert dup_res.json()["was_newly_sent"] is False
    assert dup_res.json()["notification_id"] == data["notification_id"]


def test_notification_workflow_dispatches_without_preclaim():
    """The n8n path must let dispatch own the claim, or it would always skip sending."""
    path = Path(__file__).parents[2] / "workflows" / "notification-processor.json"
    workflow = json.loads(path.read_text(encoding="utf-8"))
    links = workflow["connections"]["Webhook Notification Receiver"]["main"][0]
    assert [link["node"] for link in links] == ["Dispatch Safe Email"]
    assert all(node["name"] != "Claim Notification Task" for node in workflow["nodes"])


# ===========================================================================
# 3. W7 TESTS: Dead-Letter Queue, Capped Backoff, and Admin Retry with Reason
# ===========================================================================


def test_dead_letter_event_transition_after_max_attempts(session_factory):
    """An event exceeding max attempts transitions to 'failed' (dead-letter)."""
    envelope = EventEnvelope(
        event_id=uuid.uuid4(),
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    with session_factory() as session:
        repo = OutboxRepository(session)
        repo.save_event(envelope)
        session.commit()

    # Dispatcher that always fails retryably (e.g. n8n 503)
    def failing_dispatcher(ev: OutboxEvent) -> DispatchResult:
        return DispatchResult(
            success=False,
            status_code=503,
            error_message="n8n webhook service unavailable (HTTP 503)",
            retryable=True,
        )

    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=failing_dispatcher,
        backoff_base_seconds=0,  # 0 second backoff for fast testing
    )

    # Run cycles until attempt_count reaches max_attempts (5)
    for _ in range(5):
        worker.step()

    with session_factory() as session:
        ev = OutboxRepository(session).get_event(envelope.event_id)
        assert ev is not None
        assert ev.status == "failed"
        assert ev.attempt_count == 5
        assert "HTTP 503" in (ev.error_message or "")


def test_dead_letter_immediate_on_non_retryable_4xx(session_factory):
    """Permanent 4xx failure (e.g. 400 Bad Request) immediately goes to dead-letter."""
    envelope = EventEnvelope(
        event_id=uuid.uuid4(),
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    with session_factory() as session:
        repo = OutboxRepository(session)
        repo.save_event(envelope)
        session.commit()

    def permanent_fail_dispatcher(ev: OutboxEvent) -> DispatchResult:
        return DispatchResult(
            success=False,
            status_code=400,
            error_message="Webhook payload malformed (HTTP 400)",
            retryable=False,  # Not retryable!
        )

    worker = OutboxWorkerStub(session_factory=session_factory, dispatcher=permanent_fail_dispatcher)
    counts = worker.step()

    assert counts["claimed"] == 1
    assert counts["dead_lettered"] == 1

    with session_factory() as session:
        ev = OutboxRepository(session).get_event(envelope.event_id)
        assert ev is not None
        assert ev.status == "failed"
        assert ev.attempt_count == 1  # Did not burn remaining 4 attempts


def test_admin_retry_dead_letter_event_with_reason(db_session: Session):
    """Admin retry moves failed event to pending, resets attempts, records mandatory reason."""
    repo = OutboxRepository(db_session)
    envelope = EventEnvelope(
        event_id=uuid.uuid4(),
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    record = repo.save_event(envelope)
    record.status = "failed"
    record.attempt_count = 5
    record.error_message = "Network timeout"
    db_session.flush()

    # Retry with valid reason
    success = repo.retry_event_admin(
        envelope.event_id,
        reason="Network connectivity restored by ops team",
    )
    assert success is True
    assert record.status == "pending"
    assert record.attempt_count == 0
    assert "Admin retry: Network connectivity restored by ops team" in (record.error_message or "")


def test_admin_retry_event_idempotency(db_session: Session):
    """Retrying an event that is already pending or done returns True idempotently."""
    repo = OutboxRepository(db_session)
    envelope = EventEnvelope(
        event_id=uuid.uuid4(),
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    record = repo.save_event(envelope)
    record.status = "done"
    db_session.flush()

    # Should accept idempotently without changing done status
    assert repo.retry_event_admin(envelope.event_id, reason="redundant retry") is True
    assert record.status == "done"


def test_admin_retry_event_api_endpoint(client: TestClient, db_session: Session):
    """Test POST /internal/events/{id}/retry API."""
    repo = OutboxRepository(db_session)
    event_id = uuid.uuid4()
    envelope = EventEnvelope(
        event_id=event_id,
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    record = repo.save_event(envelope)
    record.status = "failed"
    record.attempt_count = 5
    db_session.commit()

    # 1. Admin retry with valid reason -> 202 Accepted
    response = client.post(
        f"/internal/events/{event_id}/retry",
        json={"reason": "Manual operator unblock"},
        headers=SERVICE_HEADERS,
    )
    assert response.status_code == 202, response.text
    data = response.json()
    assert data["event_id"] == str(event_id)
    assert data["status"] == "pending"
    assert data["reason"] == "Manual operator unblock"

    # Verify DB status
    db_session.refresh(record)
    assert record.status == "pending"
    assert record.attempt_count == 0

    # 2. Admin retry without reason -> 422 Unprocessable Content
    empty_reason_res = client.post(
        f"/internal/events/{event_id}/retry",
        json={"reason": ""},
        headers=SERVICE_HEADERS,
    )
    assert empty_reason_res.status_code in (422, 400)


def test_list_failed_events_api_endpoint_sanitizes_secrets(client: TestClient, db_session: Session):
    """GET /internal/events/failed lists dead-letter events and sanitizes secrets from errors."""
    repo = OutboxRepository(db_session)
    event_id = uuid.uuid4()
    envelope = EventEnvelope(
        event_id=event_id,
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    record = repo.save_event(envelope)
    record.status = "failed"
    record.attempt_count = 5
    # Error message contains secret
    record.error_message = (
        "Webhook request to http://operator:secret_password@n8n.internal:5678 failed: "
        "test-secret-w6w7"
    )
    db_session.commit()

    response = client.get("/internal/events/failed", headers=SERVICE_HEADERS)
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data["items"]) >= 1

    item = next((it for it in data["items"] if it["event_id"] == str(event_id)), None)
    assert item is not None
    # Secret must be redacted
    assert "test-secret-w6w7" not in item["error_message"]
    assert "***" in item["error_message"]


# ===========================================================================
# 4. W7 TESTS: Uncertain State Handling & Auto-Resend Prevention
# ===========================================================================


def test_uncertain_delivery_state_recorded(db_session: Session):
    """When a delivery experiences an in-flight timeout, status is set to 'uncertain'."""
    event_id = uuid.uuid4()
    incident_id = uuid.uuid4()
    email = build_reported_notification(
        incident_id=incident_id,
        reporter_user_id=REPORTER_USER_ID,
        reporter_email=REPORTER_EMAIL,
    )

    sender = DemoEmailSender()
    # Force uncertain outcome (connection timeout midway)
    sender.set_next_outcome("uncertain", "SMTP socket timeout after 10s waiting for 250 OK")

    notif, result, was_newly_sent = dispatch_notification_task(
        db=db_session, event_id=event_id, email=email, sender=sender
    )

    assert was_newly_sent is True
    assert notif.status == "uncertain"
    assert result.status == "uncertain"
    assert "SMTP socket timeout" in (notif.error_message or "")


def test_invariant_uncertain_notification_never_auto_resent(db_session: Session):
    """CRITICAL INVARIANT: Uncertain notifications must NEVER be automatically resent."""
    repo = NotificationRepository(db_session)
    event_id = uuid.uuid4()
    incident_id = uuid.uuid4()

    # 1. Claim and mark uncertain
    notif, should_send = repo.claim_notification(
        event_id=event_id,
        kind=NotificationKind.INCIDENT_REPORTED.value,
        recipient_user_id=REPORTER_USER_ID,
    )
    assert should_send is True

    repo.complete_notification(
        notification_id=notif.id,
        status="uncertain",
        error_message="Network connection reset during transmission",
    )
    db_session.flush()

    # 2. Subsequent automated claim attempt MUST return should_send = False
    notif_reclaim, should_send_reclaim = repo.claim_notification(
        event_id=event_id,
        kind=NotificationKind.INCIDENT_REPORTED.value,
        recipient_user_id=REPORTER_USER_ID,
    )
    assert should_send_reclaim is False
    assert notif_reclaim.id == notif.id
    assert notif_reclaim.status == "uncertain"

    # 3. High-level dispatch task also refuses to re-send
    email = build_reported_notification(
        incident_id=incident_id,
        reporter_user_id=REPORTER_USER_ID,
        reporter_email=REPORTER_EMAIL,
    )
    sender = DemoEmailSender()
    notif_dispatched, result_dispatched, was_newly_sent = dispatch_notification_task(
        db=db_session, event_id=event_id, email=email, sender=sender
    )
    assert was_newly_sent is False
    assert len(sender.sent_emails) == 0


def test_uncertain_notification_cannot_be_silently_overwritten_to_failed(db_session: Session):
    """Sent or uncertain notifications cannot be overwritten as failed by automated callbacks."""
    repo = NotificationRepository(db_session)
    event_id = uuid.uuid4()

    notif, _ = repo.claim_notification(
        event_id=event_id,
        kind="incident_reported",
        recipient_user_id=REPORTER_USER_ID,
    )
    repo.complete_notification(notif.id, status="uncertain", error_message="ambiguous delivery")
    db_session.flush()

    # An automated job attempting to mark it as 'failed' is rejected; status remains uncertain
    updated = repo.complete_notification(notif.id, status="failed", error_message="fail overwrite")
    assert updated is not None
    assert updated.status == "uncertain"


def test_admin_retry_uncertain_notification_with_reason(db_session: Session):
    """Only an administrator with an explicit reason can re-queue an uncertain notification."""
    repo = NotificationRepository(db_session)
    event_id = uuid.uuid4()

    notif, _ = repo.claim_notification(
        event_id=event_id,
        kind="incident_reported",
        recipient_user_id=REPORTER_USER_ID,
    )
    repo.complete_notification(notif.id, status="uncertain", error_message="timeout")
    db_session.flush()

    # Admin retry requires reason
    with pytest.raises(ValueError, match="Reason is required"):
        repo.retry_notification_admin(notif.id, reason="   ")

    # Valid admin retry
    success = repo.retry_notification_admin(
        notif.id,
        reason="Operator verified with reporter that email was not received",
    )
    assert success is True
    assert notif.status == "pending"
    assert "Admin retry: Operator verified" in (notif.error_message or "")


def test_admin_retry_notification_api_endpoint(client: TestClient, db_session: Session):
    """Test POST /internal/notifications/{id}/retry API."""
    repo = NotificationRepository(db_session)
    event_id = uuid.uuid4()

    notif, _ = repo.claim_notification(
        event_id=event_id,
        kind="incident_reported",
        recipient_user_id=REPORTER_USER_ID,
    )
    repo.complete_notification(notif.id, status="uncertain", error_message="timeout")
    db_session.commit()

    response = client.post(
        f"/internal/notifications/{notif.id}/retry",
        json={"reason": "Audited manual retry"},
        headers=SERVICE_HEADERS,
    )
    assert response.status_code == 202, response.text
    data = response.json()
    assert data["notification_id"] == str(notif.id)
    assert data["status"] == "pending"
    assert data["reason"] == "Audited manual retry"


def test_list_notifications_and_dead_letter_summary_api(client: TestClient, db_session: Session):
    """Test GET /internal/notifications and GET /internal/dead-letter/summary."""
    repo_notif = NotificationRepository(db_session)
    repo_outbox = OutboxRepository(db_session)

    # Create 1 failed outbox event
    ev = EventEnvelope(
        event_id=uuid.uuid4(),
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    rec = repo_outbox.save_event(ev)
    rec.status = "failed"

    # Create 1 uncertain notification and 1 sent notification
    n1, _ = repo_notif.claim_notification(uuid.uuid4(), "p1_alert", MANAGER_USER_ID)
    repo_notif.complete_notification(n1.id, status="uncertain", error_message="timeout")

    n2, _ = repo_notif.claim_notification(uuid.uuid4(), "incident_assigned", HANDLER_USER_ID)
    repo_notif.complete_notification(n2.id, status="sent", provider_message_id="msg-123")
    db_session.commit()

    # 1. Test GET /internal/notifications?status=uncertain
    res_filter = client.get("/internal/notifications?status=uncertain", headers=SERVICE_HEADERS)
    assert res_filter.status_code == 200
    items = res_filter.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == str(n1.id)
    assert items[0]["status"] == "uncertain"

    # 2. Test GET /internal/dead-letter/summary
    res_summary = client.get("/internal/dead-letter/summary", headers=SERVICE_HEADERS)
    assert res_summary.status_code == 200
    summary = res_summary.json()
    assert summary["failed_events_count"] >= 1
    assert summary["uncertain_notifications_count"] >= 1


# ===========================================================================
# 5. CLI ADMIN TESTS (run_worker.py)
# ===========================================================================


def test_run_worker_cli_admin_list_and_retry(monkeypatch, db_session: Session, capsys):
    """Test CLI commands for dead-letter and notification retry."""
    # Patch SessionLocal to use our in-memory SQLite session
    from app.automation import run_worker

    class MockSessionContext:
        def __enter__(self):
            return db_session

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(run_worker, "SessionLocal", lambda: MockSessionContext())

    repo_outbox = OutboxRepository(db_session)
    repo_notif = NotificationRepository(db_session)

    failed_event_id = uuid.uuid4()
    ev = EventEnvelope(
        event_id=failed_event_id,
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    rec = repo_outbox.save_event(ev)
    rec.status = "failed"
    rec.attempt_count = 5
    rec.error_message = "Permanent 400 error"

    n, _ = repo_notif.claim_notification(uuid.uuid4(), "incident_reported", REPORTER_USER_ID)
    repo_notif.complete_notification(n.id, status="uncertain", error_message="timeout")
    db_session.commit()

    # 1. Test --list-failed
    code = run_worker_main(["--list-failed"])
    assert code == 0
    captured = capsys.readouterr()
    assert str(failed_event_id) in captured.out
    assert "Permanent 400 error" in captured.out

    # 2. Test --retry-event without reason -> fails
    code_no_reason = run_worker_main(["--retry-event", str(failed_event_id)])
    assert code_no_reason == 1

    # 3. Test --retry-event with reason -> succeeds
    code_retry = run_worker_main(
        ["--retry-event", str(failed_event_id), "--reason", "CLI operator retry"]
    )
    assert code_retry == 0
    db_session.refresh(rec)
    assert rec.status == "pending"
    assert rec.attempt_count == 0

    # 4. Test --list-notifications --status uncertain
    code_list_notif = run_worker_main(["--list-notifications", "--status", "uncertain"])
    assert code_list_notif == 0
    captured_notifs = capsys.readouterr()
    assert str(n.id) in captured_notifs.out

    # 5. Test --retry-notification with reason -> succeeds
    code_retry_notif = run_worker_main(
        ["--retry-notification", str(n.id), "--reason", "CLI retry uncertain email"]
    )
    assert code_retry_notif == 0
    db_session.refresh(n)
    assert n.status == "pending"
