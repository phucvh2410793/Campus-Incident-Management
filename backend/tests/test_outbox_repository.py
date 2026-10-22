import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from app.automation.fixtures import (
    SAMPLE_INCIDENT_ID,
    SAMPLE_REQUEST_ID,
    get_fixture_reported_event,
)
from app.automation.models import Notification, OutboxEvent
from app.automation.publisher import IdempotencyConflictError, OutboxEventPublisher
from app.automation.repository import NotificationRepository, OutboxRepository
from app.automation.schemas import EventEnvelope, EventType
from app.automation.worker import OutboxWorkerStub


@pytest.fixture
def db_session():
    """Create an isolated in-memory SQLite database with fresh schema for testing."""
    engine = sa.create_engine("sqlite:///:memory:")
    OutboxEvent.__table__.create(engine)
    Notification.__table__.create(engine)
    session_cls = sessionmaker(bind=engine)
    with session_cls() as session:
        yield session
    Notification.__table__.drop(engine)
    OutboxEvent.__table__.drop(engine)


@pytest.fixture
def session_factory():
    """Create a sessionmaker for worker stub testing."""
    engine = sa.create_engine("sqlite:///:memory:")
    OutboxEvent.__table__.create(engine)
    Notification.__table__.create(engine)
    return sessionmaker(bind=engine)


def test_save_and_retrieve_outbox_event(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope = get_fixture_reported_event()

    record = repo.save_event(envelope)
    db_session.flush()

    assert record.id == envelope.event_id
    assert record.event_type == "incident.reported"
    assert record.status == "pending"
    assert record.attempt_count == 0
    assert record.payload is not None
    assert record.payload["incident_id"] == str(envelope.incident_id)


def test_outbox_event_idempotency_same_payload(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope = get_fixture_reported_event()

    record1 = repo.save_event(envelope)
    db_session.flush()

    record2 = repo.save_event(envelope)
    db_session.flush()

    assert record1.id == record2.id


def test_outbox_event_idempotency_conflict(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope1 = get_fixture_reported_event()
    repo.save_event(envelope1)
    db_session.flush()

    # Conflicting envelope with same event_id but different incident_id
    conflicting = EventEnvelope(
        event_id=envelope1.event_id,
        event_type=envelope1.event_type,
        incident_id=uuid.uuid4(),
        request_id=envelope1.request_id,
        occurred_at=envelope1.occurred_at,
    )

    with pytest.raises(IdempotencyConflictError):
        repo.save_event(conflicting)


def test_claim_outbox_events_lease(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope = get_fixture_reported_event()
    repo.save_event(envelope)
    db_session.flush()

    now = datetime(2026, 10, 22, 10, 0, 0, tzinfo=UTC)
    claimed = repo.claim_events(limit=5, lease_duration_seconds=60, worker_id="worker-1", now=now)

    assert len(claimed) == 1
    ev = claimed[0]
    assert ev.status == "processing"
    assert ev.lease_token == "worker-1"
    assert ev.lease_expires_at == now + timedelta(seconds=60)
    assert ev.attempt_count == 1
    assert ev.last_attempt_at == now

    # Second claim attempt immediately should find 0 events (lease is still active)
    second_claim = repo.claim_events(
        limit=5, lease_duration_seconds=60, worker_id="worker-2", now=now
    )
    assert len(second_claim) == 0


def test_claim_recovers_expired_lease(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope = get_fixture_reported_event()
    repo.save_event(envelope)
    db_session.flush()

    t0 = datetime(2026, 10, 22, 10, 0, 0, tzinfo=UTC)
    repo.claim_events(limit=5, lease_duration_seconds=60, worker_id="crashed-worker", now=t0)

    # Fast-forward past lease expiration (e.g. 61 seconds later)
    t1 = t0 + timedelta(seconds=65)
    recovered = repo.claim_events(
        limit=5, lease_duration_seconds=60, worker_id="healthy-worker", now=t1
    )

    assert len(recovered) == 1
    ev = recovered[0]
    assert ev.lease_token == "healthy-worker"
    assert ev.attempt_count == 2


def test_complete_outbox_event(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope = get_fixture_reported_event()
    repo.save_event(envelope)
    db_session.flush()

    repo.claim_events(limit=1, worker_id="worker-1")
    success = repo.complete_event(envelope.event_id, lease_token="worker-1")

    assert success is True
    ev = repo.get_event(envelope.event_id)
    assert ev is not None
    assert ev.status == "done"
    assert ev.lease_token is None
    assert ev.lease_expires_at is None


def test_complete_with_wrong_lease_token_rejected(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope = get_fixture_reported_event()
    repo.save_event(envelope)
    db_session.flush()

    repo.claim_events(limit=1, worker_id="worker-1")
    rejected = repo.complete_event(envelope.event_id, lease_token="imposter-worker")

    assert rejected is False
    ev = repo.get_event(envelope.event_id)
    assert ev is not None
    assert ev.status == "processing"


def test_fail_outbox_event_with_backoff_and_exhaustion(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope = get_fixture_reported_event()
    record = repo.save_event(envelope)
    record.max_attempts = 3
    db_session.flush()

    now = datetime(2026, 10, 22, 12, 0, 0, tzinfo=UTC)

    # Attempt 1 fails
    repo.claim_events(limit=1, worker_id="worker-1", now=now)
    repo.fail_event(
        envelope.event_id,
        error_message="n8n timeout",
        lease_token="worker-1",
        backoff_base_seconds=5,
        now=now,
    )

    ev = repo.get_event(envelope.event_id)
    assert ev is not None
    assert ev.status == "pending"
    assert ev.attempt_count == 1
    # backoff = 5 * 2^0 = 5s
    assert ev.next_attempt_at == now + timedelta(seconds=5)

    # Attempt 2 fails
    now2 = now + timedelta(seconds=10)
    repo.claim_events(limit=1, worker_id="worker-1", now=now2)
    repo.fail_event(
        envelope.event_id,
        error_message="n8n connection refused",
        lease_token="worker-1",
        backoff_base_seconds=5,
        now=now2,
    )
    ev = repo.get_event(envelope.event_id)
    assert ev is not None
    assert ev.status == "pending"
    assert ev.attempt_count == 2
    # backoff = 5 * 2^1 = 10s
    assert ev.next_attempt_at == now2 + timedelta(seconds=10)

    # Attempt 3 fails -> max_attempts reached -> status='failed' (dead-letter)
    now3 = now2 + timedelta(seconds=15)
    repo.claim_events(limit=1, worker_id="worker-1", now=now3)
    repo.fail_event(
        envelope.event_id,
        error_message="internal 500 error",
        lease_token="worker-1",
        backoff_base_seconds=5,
        now=now3,
    )
    ev = repo.get_event(envelope.event_id)
    assert ev is not None
    assert ev.status == "failed"
    assert ev.attempt_count == 3
    assert ev.next_attempt_at is None


def test_admin_retry_failed_event(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope = get_fixture_reported_event()
    record = repo.save_event(envelope)
    record.status = "failed"
    record.attempt_count = 5
    db_session.flush()

    now = datetime(2026, 10, 22, 14, 0, 0, tzinfo=UTC)
    result = repo.retry_event_admin(envelope.event_id, reason="n8n service restored", now=now)

    assert result is True
    ev = repo.get_event(envelope.event_id)
    assert ev is not None
    assert ev.status == "pending"
    assert ev.attempt_count == 0
    assert ev.next_attempt_at == now
    assert "Admin retry: n8n service restored" in (ev.error_message or "")


def test_admin_retry_idempotent_on_done_or_pending(db_session: Session):
    repo = OutboxRepository(db_session)
    envelope = get_fixture_reported_event()
    record = repo.save_event(envelope)
    record.status = "done"
    db_session.flush()

    assert repo.retry_event_admin(envelope.event_id, reason="redundant retry") is True
    assert record.status == "done"


def test_notification_claim_idempotency(db_session: Session):
    repo = NotificationRepository(db_session)
    event_id = uuid.uuid4()
    recipient_id = uuid.uuid4()
    kind = "incident_reported"

    # First claim -> creates and should_send=True
    notif1, should_send1 = repo.claim_notification(event_id, kind, recipient_id)
    assert should_send1 is True
    assert notif1.status == "pending"
    assert notif1.event_id == event_id

    # Second claim with identical (event_id, kind, recipient_user_id)
    # -> returns existing, should_send=False
    notif2, should_send2 = repo.claim_notification(event_id, kind, recipient_id)
    assert should_send2 is False
    assert notif2.id == notif1.id


def test_notification_completion_and_immutability(db_session: Session):
    repo = NotificationRepository(db_session)
    event_id = uuid.uuid4()
    recipient_id = uuid.uuid4()
    kind = "incident_assigned"

    notif, _ = repo.claim_notification(event_id, kind, recipient_id)

    # Mark as sent
    completed = repo.complete_notification(
        notif.id,
        status="sent",
        provider_message_id="msg-smtp-999",
    )
    assert completed is not None
    assert completed.status == "sent"
    assert completed.provider_message_id == "msg-smtp-999"

    # Sent notifications cannot be overwritten as failed (no auto resend)
    cannot_fail = repo.complete_notification(notif.id, status="failed")
    assert cannot_fail is not None
    assert cannot_fail.status == "sent"


def test_outbox_worker_stub_execution(session_factory):
    # Setup initial event in DB
    envelope = get_fixture_reported_event()
    with session_factory() as session:
        repo = OutboxRepository(session)
        repo.save_event(envelope)
        session.commit()

    dispatched_events = []

    def mock_dispatcher(ev: OutboxEvent) -> bool:
        dispatched_events.append(ev.id)
        return True

    worker = OutboxWorkerStub(session_factory=session_factory, dispatcher=mock_dispatcher)

    stats = worker.step()
    assert stats["claimed"] == 1
    assert stats["processed"] == 1
    assert stats["failed"] == 0
    assert len(dispatched_events) == 1

    # Verify event marked done in DB
    with session_factory() as session:
        ev = OutboxRepository(session).get_event(envelope.event_id)
        assert ev is not None
        assert ev.status == "done"


def test_outbox_event_publisher_transactional(db_session: Session):
    publisher = OutboxEventPublisher(db_session)
    envelope = publisher.create_and_publish(
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )

    db_session.flush()

    repo = OutboxRepository(db_session)
    saved = repo.get_event(envelope.event_id)
    assert saved is not None
    assert saved.event_type == "incident.reported"
    assert saved.status == "pending"
    assert saved.incident_id == SAMPLE_INCIDENT_ID
