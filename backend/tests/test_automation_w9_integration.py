"""N5 W9 integration tests: Public state notifications, idempotency and content safety.

Acceptance criteria (W9 · 07/12/2026–13/12/2026):
1. Reporter receives updates for valid public states (assigned, in_progress, resolved, closed).
2. Content safety guards strictly enforce that public state emails contain ONLY public information:
   - Forbid internal notes ([internal], internal_note, internal_comment, visibility: internal).
   - Forbid raw secrets (passwords, bearer tokens, API secrets).
   - Forbid file attachments / base64 binaries / file download tokens.
   - Forbid staff internal links (/staff/*); link must point to public view /incidents/{id}.
3. Idempotency lock via (event_id, 'public_state_updated', reporter_user_id):
   - Claiming once returns should_send=True and delivers email.
   - Repeated claims (e.g. from retries/replays) return should_send=False; no duplicate emails.
4. Retry invariant:
   - Retries do not create duplicate emails outside policy.
   - 'sent' and 'uncertain' notifications are never automatically re-dispatched.
"""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.models import Session as UserSession
from app.automation.models import Notification, OutboxEvent
from app.automation.notifications import (
    NotificationKind,
    NotificationSecurityError,
    build_public_state_notification,
)
from app.automation.repository import NotificationRepository
from app.automation.router import _IN_MEMORY_NOTIFICATIONS_STORE
from app.automation.service_auth import (
    DEFAULT_DEMO_SERVICE_TOKEN,
    clear_test_user_tokens,
    get_optional_db,
    token_manager,
)
from app.incidents.models import Incident
from app.main import app
from app.models import Department, User

SERVICE_HEADERS = {"Authorization": f"Bearer {DEFAULT_DEMO_SERVICE_TOKEN}"}


@pytest.fixture(autouse=True)
def isolated_configuration():
    token_manager.reset()
    clear_test_user_tokens()
    _IN_MEMORY_NOTIFICATIONS_STORE.clear()
    yield
    token_manager.reset()
    clear_test_user_tokens()
    _IN_MEMORY_NOTIFICATIONS_STORE.clear()


@pytest.fixture
def test_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.connect() as conn:
        conn.connection.driver_connection.create_function(
            "jsonb_typeof",
            1,
            lambda value: "object",
        )
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
        reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
        session.add(
            User(
                id=reporter_id,
                email="reporter@demo.invalid",
                display_name="Demo Reporter",
                role="reporter",
                password_hash="demo_hash_w9",
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
# 1. Public state email generation and safety guards
# ===========================================================================


def test_build_public_state_notification_valid_states():
    """Verify email builder works for all legitimate public lifecycle states."""
    incident_id = uuid.uuid4()
    reporter_id = uuid.uuid4()
    reporter_email = "reporter@demo.invalid"

    for state in ["assigned", "in_progress", "resolved", "closed", "reopened"]:
        email = build_public_state_notification(
            incident_id=incident_id,
            reporter_user_id=reporter_id,
            reporter_email=reporter_email,
            new_state=state,
            resolution_summary="Đã sửa chữa xong đường ống nước" if state == "resolved" else None,
        )
        assert email.kind == NotificationKind.PUBLIC_STATE_UPDATED
        assert email.incident_id == incident_id
        assert f"/incidents/{incident_id}" in email.link
        assert "/staff/" not in email.link
        assert email.recipient_email == reporter_email


def test_build_public_state_notification_rejects_invalid_state():
    """Rejects unknown or internal-only lifecycle states."""
    with pytest.raises(ValueError, match="Invalid public state"):
        build_public_state_notification(
            incident_id=uuid.uuid4(),
            reporter_user_id=uuid.uuid4(),
            reporter_email="reporter@demo.invalid",
            new_state="triage_pending_internal_review",
        )


def test_content_guard_rejects_internal_notes_in_public_state():
    """Strictly prevents internal notes from slipping into reporter emails."""
    incident_id = uuid.uuid4()
    reporter_id = uuid.uuid4()

    with pytest.raises(NotificationSecurityError, match="Prohibited internal note"):
        build_public_state_notification(
            incident_id=incident_id,
            reporter_user_id=reporter_id,
            reporter_email="reporter@demo.invalid",
            new_state="resolved",
            resolution_summary="Đã sửa xong [internal] ghi chú nội bộ: nghi ngờ do sinh viên phá",
        )


def test_content_guard_rejects_staff_portal_link_in_public_email():
    """Reporter must never be directed to the staff management portal."""
    incident_id = uuid.uuid4()
    reporter_id = uuid.uuid4()

    with pytest.raises(NotificationSecurityError, match="Prohibited staff portal link"):
        build_public_state_notification(
            incident_id=incident_id,
            reporter_user_id=reporter_id,
            reporter_email="reporter@demo.invalid",
            new_state="in_progress",
            resolution_summary="Xem chi tiết tại /staff/incidents/123",
        )


def test_content_guard_rejects_secrets_in_public_email():
    """Forbids passwords or tokens in resolution summary."""
    incident_id = uuid.uuid4()
    reporter_id = uuid.uuid4()

    with pytest.raises(NotificationSecurityError, match="Prohibited secret"):
        build_public_state_notification(
            incident_id=incident_id,
            reporter_user_id=reporter_id,
            reporter_email="reporter@demo.invalid",
            new_state="resolved",
            resolution_summary="Đã reset password cho tài khoản của bạn",
        )


# ===========================================================================
# 2. Idempotency and anti-duplicate retry policy
# ===========================================================================


def test_public_state_notification_idempotency_in_repository(db_session: Session):
    """(event_id, kind, recipient_user_id) ensures exactly one dispatch."""
    event_id = uuid.uuid4()
    reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    repo = NotificationRepository(db_session)

    # First claim -> should_send=True
    notif1, should_send1 = repo.claim_notification(
        event_id=event_id,
        kind=NotificationKind.PUBLIC_STATE_UPDATED.value,
        recipient_user_id=reporter_id,
    )
    assert should_send1 is True
    assert notif1.status == "pending"

    # Mark as sent
    repo.complete_notification(notif1.id, status="sent", provider_message_id="msg-w9-001")
    db_session.commit()

    # Second claim (e.g. n8n replay / retry) -> should_send=False
    notif2, should_send2 = repo.claim_notification(
        event_id=event_id,
        kind=NotificationKind.PUBLIC_STATE_UPDATED.value,
        recipient_user_id=reporter_id,
    )
    assert should_send2 is False
    assert notif2.id == notif1.id
    assert notif2.status == "sent"


def test_public_state_claim_is_atomic_across_postgresql_sessions():
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("PostgreSQL test database is not configured")

    engine = create_engine(database_url)
    reporter_id = uuid.uuid4()
    event_id = uuid.uuid4()
    barrier = Barrier(2)
    try:
        with engine.begin() as connection:
            connection.execute(
                User.__table__.insert().values(
                    id=reporter_id,
                    email=f"{reporter_id}@demo.invalid",
                    display_name="Concurrent claim reporter",
                    password_hash="test_hash",
                    role="reporter",
                )
            )

        def claim_once():
            with Session(engine) as session:
                barrier.wait(timeout=5)
                notification, should_send = NotificationRepository(session).claim_notification(
                    event_id=event_id,
                    kind=NotificationKind.PUBLIC_STATE_UPDATED.value,
                    recipient_user_id=reporter_id,
                )
                notification_id = notification.id
                session.commit()
                return notification_id, should_send

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: claim_once(), range(2)))
        assert len({item[0] for item in results}) == 1
        assert sorted(item[1] for item in results) == [False, True]
    finally:
        with engine.begin() as connection:
            connection.execute(
                Notification.__table__.delete().where(Notification.event_id == event_id)
            )
            connection.execute(User.__table__.delete().where(User.id == reporter_id))
        engine.dispose()


def test_dispatch_public_state_notification_via_api(client: TestClient, db_session: Session):
    """POST /internal/notifications/dispatch handles public_state_updated scenario."""
    event_id = uuid.uuid4()
    incident_id = uuid.uuid4()
    reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    db_session.add(
        Incident(
            id=incident_id,
            reporter_id=reporter_id,
            category="water_leak",
            title="Water leak in the library",
            description="Water is leaking from the ceiling in the main library.",
            building="Library",
            answers={},
            status="resolved",
        )
    )
    db_session.commit()

    payload = {
        "event_id": str(event_id),
        "scenario": "public_state_updated",
        "recipient_user_id": str(reporter_id),
        "recipient_email": "reporter@demo.invalid",
        "incident_id": str(incident_id),
        "new_state": "resolved",
        "resolution_summary": "Kỹ thuật viên đã thay van xả nước và kiểm tra an toàn áp lực",
    }

    # 1. First dispatch: sent successfully
    res1 = client.post("/internal/notifications/dispatch", json=payload, headers=SERVICE_HEADERS)
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["status"] == "sent"
    assert data1["was_newly_sent"] is True
    assert f"/incidents/{incident_id}" in data1["link"]
    assert "Đã được xử lý" in data1["subject"]

    # 2. Retry with same payload: skipped, no duplicate email
    res2 = client.post("/internal/notifications/dispatch", json=payload, headers=SERVICE_HEADERS)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["notification_id"] == data1["notification_id"]
    assert data2["was_newly_sent"] is False  # SKIPPED: anti-duplicate lock active!

    wrong_recipient = {
        **payload,
        "event_id": str(uuid.uuid4()),
        "recipient_email": "other@demo.invalid",
    }
    rejected = client.post(
        "/internal/notifications/dispatch", json=wrong_recipient, headers=SERVICE_HEADERS
    )
    assert rejected.status_code == 403


def test_api_rejects_internal_note_in_public_state_dispatch(client: TestClient):
    """API endpoint rejects public state update containing internal note."""
    payload = {
        "event_id": str(uuid.uuid4()),
        "scenario": "public_state_updated",
        "recipient_user_id": str(uuid.uuid4()),
        "recipient_email": "reporter@demo.invalid",
        "incident_id": str(uuid.uuid4()),
        "new_state": "resolved",
        "resolution_summary": "Đã sửa xong [internal] ghi chú nội bộ không gửi",
    }
    res = client.post("/internal/notifications/dispatch", json=payload, headers=SERVICE_HEADERS)
    assert res.status_code == 422
    assert "Prohibited internal note" in res.json()["detail"]
