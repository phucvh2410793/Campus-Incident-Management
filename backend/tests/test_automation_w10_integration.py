"""N5 W10 resilience tests: Fault tolerance, duplicate handling, clock skew, restart recovery.
Tests coverage for T13-T15 test plan scenarios.

Acceptance criteria (W10 · 14/12/2026–20/12/2026):
1. T13 (Duplicate event/webhook):
   - Duplicate delivery does not duplicate assignments, status history, or emails.
   - Idempotency is preserved across outbox, n8n webhook and notification layers.
2. T14 (n8n down during incident creation):
   - Incidents are saved atomically in DB even if n8n is offline or unreachable.
   - Outbox worker retries with bounded exponential backoff; no events are lost.
   - When n8n recovers, pending events are dispatched and processed successfully.
3. T15 (Email / API failure during workflow):
   - Transient failures (network timeout, 5xx) enter retry queue with bounded backoff.
   - Permanent 4xx failures move directly to dead-letter (failed).
   - Uncertain delivery is never automatically resent.
   - Admin can review dead-letter queue and retry with mandatory reason.
4. Clock skew tolerance:
   - HMAC timestamp verification allows up to 300 seconds skew in past and future.
   - Timestamps skewed beyond 300 seconds are rejected (401).
5. Restart recovery:
   - Worker crash leaves events in 'processing'; on restart, expired leases return to 'pending'
     without duplicating business operations.
"""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.models import Session as UserSession
from app.auth.seed_demo import DEMO_DEPARTMENTS
from app.automation.fixtures import SAMPLE_REQUEST_ID
from app.automation.models import Notification, OutboxEvent
from app.automation.notifications import (
    DemoEmailSender,
    build_assigned_notification,
    dispatch_notification_task,
)
from app.automation.publisher import (
    InMemoryEventPublisher,
    OutboxEventPublisher,
    set_event_publisher,
)
from app.automation.repository import NotificationRepository, OutboxRepository
from app.automation.router import _IN_MEMORY_EVALUATIONS, _IN_MEMORY_NOTIFICATIONS_STORE
from app.automation.schemas import EventEnvelope, EventType
from app.automation.security import build_webhook_headers
from app.automation.service_auth import (
    DEFAULT_DEMO_SERVICE_TOKEN,
    clear_test_user_tokens,
    get_optional_db,
    token_manager,
)
from app.automation.webhook import DispatchResult
from app.automation.worker import OutboxWorkerStub
from app.incidents.models import Incident
from app.main import app
from app.models import Department, User

TEST_SECRET = "w10-resilience-secret-88f2"
SERVICE_HEADERS = {"Authorization": f"Bearer {DEFAULT_DEMO_SERVICE_TOKEN}"}


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch):
    monkeypatch.setenv("CIM_WEBHOOK_HMAC_SECRET", TEST_SECRET)
    monkeypatch.delenv("CIM_WEBHOOK_HMAC_SECRETS_ROTATION", raising=False)
    monkeypatch.delenv("CIM_INTERNAL_SERVICE_BEARER_TOKENS", raising=False)
    monkeypatch.delenv("CIM_INTERNAL_SERVICE_TOKEN_HASHES", raising=False)

    token_manager.reset()
    clear_test_user_tokens()
    _IN_MEMORY_EVALUATIONS.clear()
    _IN_MEMORY_NOTIFICATIONS_STORE.clear()
    set_event_publisher(InMemoryEventPublisher())
    yield
    token_manager.reset()
    clear_test_user_tokens()
    _IN_MEMORY_EVALUATIONS.clear()
    _IN_MEMORY_NOTIFICATIONS_STORE.clear()


@pytest.fixture
def test_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.connect() as conn:
        conn.connection.driver_connection.create_function("jsonb_typeof", 1, lambda val: "object")
        Department.__table__.create(conn)
        User.__table__.create(conn)
        Incident.__table__.create(conn)
        Notification.__table__.create(conn)
        OutboxEvent.__table__.create(conn)
        UserSession.__table__.create(conn)
        conn.commit()

    yield engine

    with engine.connect() as conn:
        UserSession.__table__.drop(conn)
        OutboxEvent.__table__.drop(conn)
        Notification.__table__.drop(conn)
        Incident.__table__.drop(conn)
        User.__table__.drop(conn)
        Department.__table__.drop(conn)
        conn.commit()


@pytest.fixture
def session_factory(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture
def db_session(session_factory):
    with session_factory() as session:
        for did, name in DEMO_DEPARTMENTS:
            session.add(Department(id=did, name=name))
        reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
        handler_id = uuid.UUID("10000000-0000-4000-8000-000000000002")
        session.add(
            User(
                id=reporter_id,
                email="reporter@demo.invalid",
                display_name="Demo Reporter",
                role="reporter",
                password_hash="demo_hash",
            )
        )
        session.add(
            User(
                id=handler_id,
                email="handler@demo.invalid",
                display_name="Demo Handler",
                role="handler",
                password_hash="demo_hash",
            )
        )
        session.commit()
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
# 1. T13: Duplicate Delivery & Anti-Duplication
# ===========================================================================


def test_t13_duplicate_event_webhook_does_not_duplicate_assignment(
    client: TestClient, db_session: Session
):
    """T13: Duplicate webhook deliveries skip evaluation and do not duplicate assignments."""
    reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    incident = Incident(
        reporter_id=reporter_id,
        category="electrical_hazard",
        title="T13 Duplicate test incident",
        description="Testing duplicate webhook deliveries without double assignment",
        building="Hall A",
        answers={"smoke_or_sparks": "yes"},
        reported_at=datetime.now(UTC),
        status="reported",
    )
    db_session.add(incident)
    db_session.flush()

    publisher = OutboxEventPublisher(db_session)
    envelope = publisher.create_and_publish(
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=incident.id,
        request_id=SAMPLE_REQUEST_ID,
    )
    db_session.commit()
    event_id = envelope.event_id

    # First delivery: evaluation performed
    res1 = client.post(
        f"/internal/events/{event_id}/evaluate",
        json={"run_id": "run-t13-1"},
        headers=SERVICE_HEADERS,
    )
    assert res1.status_code == 200
    assert res1.json()["rule_id"] == "R01"

    # Mark done
    client.post(
        f"/internal/events/{event_id}/complete",
        json={"run_id": "run-t13-1", "status": "done"},
        headers=SERVICE_HEADERS,
    )

    # Second delivery: verify GET /internal/events/{id} returns done (duplicate detection)
    check = client.get(f"/internal/events/{event_id}", headers=SERVICE_HEADERS)
    assert check.status_code == 200
    assert check.json()["status"] == "done"

    # Evaluate again: idempotent response, no state transition duplication
    res2 = client.post(
        f"/internal/events/{event_id}/evaluate",
        json={"run_id": "run-t13-2"},
        headers=SERVICE_HEADERS,
    )
    assert res2.status_code == 200
    assert res2.json() == res1.json()

    # Verify incident version remains 1 (no double increment)
    db_session.refresh(incident)
    assert incident.version == 1


def test_t13_duplicate_notification_dispatch_does_not_send_twice(
    client: TestClient, db_session: Session
):
    """T13: Duplicate notification dispatch calls do not produce duplicate emails."""
    event_id = uuid.uuid4()
    incident_id = uuid.uuid4()
    handler_id = uuid.UUID("10000000-0000-4000-8000-000000000002")

    payload = {
        "event_id": str(event_id),
        "scenario": "assigned",
        "recipient_user_id": str(handler_id),
        "recipient_email": "handler@demo.invalid",
        "incident_id": str(incident_id),
        "department_name": "Điện và an toàn",
        "priority": "P1",
    }

    # Delivery 1: sent
    r1 = client.post("/internal/notifications/dispatch", json=payload, headers=SERVICE_HEADERS)
    assert r1.status_code == 200
    assert r1.json()["was_newly_sent"] is True

    # Delivery 2: skipped (anti-duplicate lock active)
    r2 = client.post("/internal/notifications/dispatch", json=payload, headers=SERVICE_HEADERS)
    assert r2.status_code == 200
    assert r2.json()["was_newly_sent"] is False
    assert r2.json()["notification_id"] == r1.json()["notification_id"]


# ===========================================================================
# 2. T14: n8n Down During Incident Creation & Graceful Recovery
# ===========================================================================


def test_t14_incident_saved_when_n8n_down_and_worker_recovers(db_session: Session, session_factory):
    """T14: Incident is committed atomically to DB; worker retries until n8n is back."""
    reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    now = datetime.now(UTC)

    # 1. Incident saved in DB with pending event
    incident = Incident(
        reporter_id=reporter_id,
        category="water_leak",
        title="T14 Water leak with n8n down",
        description="Incident created while n8n is completely offline",
        building="Building E",
        answers={"leak_amount": "large", "near_electricity": "no"},
        reported_at=now,
        status="reported",
    )
    db_session.add(incident)
    db_session.flush()

    publisher = OutboxEventPublisher(db_session)
    envelope = publisher.create_and_publish(
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=incident.id,
        request_id=SAMPLE_REQUEST_ID,
    )
    db_session.commit()
    event_id = envelope.event_id

    # Confirm incident is safely persisted in DB
    assert db_session.get(Incident, incident.id) is not None

    # 2. Worker attempts dispatch while n8n is down (simulate network error)
    def broken_dispatcher(event):
        return DispatchResult(
            success=False,
            error_code="connection_refused",
            error_message="HTTPConnectionPool: Max retries exceeded (Connection refused)",
            retryable=True,
        )

    worker = OutboxWorkerStub(session_factory=session_factory, dispatcher=broken_dispatcher)
    cycle1 = worker.run_cycle()
    assert cycle1.claimed == 1
    assert cycle1.failed == 1
    assert cycle1.processed == 0

    # Event must NOT be lost: returned to pending with backoff
    repo = OutboxRepository(db_session)
    ev = repo.get_event(event_id)
    assert ev.status == "pending"
    assert ev.attempt_count == 1
    assert "Connection refused" in ev.error_message

    # 3. n8n comes back online: next cycle successfully delivers
    def recovered_dispatcher(event):
        return DispatchResult(success=True)

    # Fast forward next_attempt_at
    ev.next_attempt_at = now - timedelta(seconds=1)
    db_session.commit()

    worker_ok = OutboxWorkerStub(session_factory=session_factory, dispatcher=recovered_dispatcher)
    cycle2 = worker_ok.run_cycle()
    assert cycle2.claimed == 1
    assert cycle2.processed == 1

    db_session.refresh(ev)
    assert ev.status == "done"


# ===========================================================================
# 3. T15: Email/API Failures, Dead-Letter Queue & Admin Recovery
# ===========================================================================


def test_t15_email_failure_and_uncertain_invariant(db_session: Session):
    """T15: Email failure outcomes; uncertain delivery is never automatically resent."""
    event_id = uuid.uuid4()
    incident_id = uuid.uuid4()
    handler_id = uuid.UUID("10000000-0000-4000-8000-000000000002")

    email = build_assigned_notification(
        incident_id=incident_id,
        handler_user_id=handler_id,
        handler_email="handler@demo.invalid",
    )

    sender = DemoEmailSender()
    sender.set_next_outcome("uncertain", error_message="SMTP socket read timeout")

    notif, res, newly_sent = dispatch_notification_task(
        db=db_session,
        event_id=event_id,
        email=email,
        sender=sender,
    )
    db_session.commit()

    assert notif.status == "uncertain"
    assert newly_sent is True

    # Critical invariant: uncertain notification can NEVER be claimed again automatically
    repo = NotificationRepository(db_session)
    n_again, should_send = repo.claim_notification(
        event_id=event_id,
        kind=email.kind.value,
        recipient_user_id=handler_id,
    )
    assert should_send is False  # Invariant held: NO automatic resend!
    assert n_again.status == "uncertain"


def test_t15_dead_letter_admin_retry_with_mandatory_reason(db_session: Session, session_factory):
    """T15: Dead-letter outbox event requires mandatory reason to re-queue."""
    envelope = EventEnvelope(
        event_id=uuid.uuid4(),
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=uuid.uuid4(),
        request_id=SAMPLE_REQUEST_ID,
    )
    repo = OutboxRepository(db_session)
    ev = repo.save_event(envelope)
    repo.fail_event(ev.id, error_message="Persistent 400 Bad Request", retryable=False)
    db_session.commit()
    assert ev.status == "failed"

    # Attempt retry without reason -> rejected
    with pytest.raises(ValueError, match="Admin retry requires a reason"):
        repo.retry_event_admin(ev.id, reason="")

    # Retry with explicit audit reason -> succeeded, reset to pending
    repo.retry_event_admin(ev.id, reason="n8n webhook schema was repaired")
    db_session.commit()
    db_session.refresh(ev)
    assert ev.status == "pending"
    assert ev.attempt_count == 0


# ===========================================================================
# 4. Clock Skew Tolerance (300 seconds window)
# ===========================================================================


def test_clock_skew_tolerance_accepts_within_300s_and_rejects_beyond(client: TestClient):
    """Chữ ký webhook chấp nhận lệch đồng hồ tối đa 300s, từ chối khi lệch quá mức."""
    event_id = uuid.uuid4()
    raw_body = json.dumps({"test": "clock_skew"}).encode("utf-8")
    now_ts = int(time.time())

    # Case 1: Lệch 290s trong quá khứ -> chấp nhận (200)
    h_past_ok = build_webhook_headers(event_id, raw_body, TEST_SECRET, timestamp=now_ts - 290)
    r1 = client.post(
        "/internal/webhooks/verify",
        data=raw_body,
        headers={**SERVICE_HEADERS, **h_past_ok, "Content-Type": "application/json"},
    )
    assert r1.status_code == 200

    # Case 2: Lệch 290s trong tương lai -> chấp nhận (200)
    h_future_ok = build_webhook_headers(event_id, raw_body, TEST_SECRET, timestamp=now_ts + 290)
    r2 = client.post(
        "/internal/webhooks/verify",
        data=raw_body,
        headers={**SERVICE_HEADERS, **h_future_ok, "Content-Type": "application/json"},
    )
    assert r2.status_code == 200

    # Case 3: Lệch 305s trong quá khứ -> từ chối (401)
    h_past_fail = build_webhook_headers(event_id, raw_body, TEST_SECRET, timestamp=now_ts - 305)
    r3 = client.post(
        "/internal/webhooks/verify",
        data=raw_body,
        headers={**SERVICE_HEADERS, **h_past_fail, "Content-Type": "application/json"},
    )
    assert r3.status_code == 401
    assert "quá hạn" in r3.json()["detail"].lower() or "expired" in r3.json()["detail"].lower()

    # Case 4: Lệch 305s trong tương lai -> từ chối (401)
    h_future_fail = build_webhook_headers(event_id, raw_body, TEST_SECRET, timestamp=now_ts + 305)
    r4 = client.post(
        "/internal/webhooks/verify",
        data=raw_body,
        headers={**SERVICE_HEADERS, **h_future_fail, "Content-Type": "application/json"},
    )
    assert r4.status_code == 401
    assert "tương lai" in r4.json()["detail"].lower() or "future" in r4.json()["detail"].lower()


# ===========================================================================
# 5. Restart Crash Recovery
# ===========================================================================


def test_worker_restart_recovers_interrupted_processing_events(
    db_session: Session, session_factory
):
    """Crash recovery: events left in 'processing' with expired lease return to 'pending'."""
    now = datetime.now(UTC)
    repo = OutboxRepository(db_session)

    # Simulate an event that was being processed by a worker that crashed 2 minutes ago
    envelope = EventEnvelope(
        event_id=uuid.uuid4(),
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=uuid.uuid4(),
        request_id=SAMPLE_REQUEST_ID,
    )
    ev = repo.save_event(envelope)
    ev.status = "processing"
    ev.lease_token = "crashed-worker-pid-999"
    ev.lease_expires_at = now - timedelta(seconds=60)  # Lease expired
    db_session.commit()

    # New worker instance starts up and runs recover_interrupted_events()
    new_worker = OutboxWorkerStub(session_factory=session_factory)
    recovered = new_worker.recover_interrupted_events(now=now)
    assert recovered == 1

    # Verify event returned to pending with reset lease
    db_session.refresh(ev)
    assert ev.status == "pending"
    assert ev.lease_token is None
    assert ev.lease_expires_at is None
