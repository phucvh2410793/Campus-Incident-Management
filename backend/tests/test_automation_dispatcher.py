import json
import threading
import uuid
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.automation import run_worker
from app.automation.config import OutboxSettings
from app.automation.fixtures import get_fixture_reported_event
from app.automation.models import Notification, OutboxEvent
from app.automation.repository import OutboxRepository
from app.automation.security import (
    calculate_signature,
    get_configured_webhook_secrets,
    verify_webhook_request,
)
from app.automation.webhook import DispatchResult, WebhookDispatcher, sanitize_error_message
from app.automation.worker import OutboxWorkerStub

TEST_SECRET = "w4-test-webhook-secret-8f2a"


@pytest.fixture(autouse=True)
def webhook_secret_env(monkeypatch):
    monkeypatch.setenv("CIM_WEBHOOK_HMAC_SECRET", TEST_SECRET)
    monkeypatch.delenv("CIM_WEBHOOK_HMAC_SECRETS_ROTATION", raising=False)


@pytest.fixture
def db_session():
    engine = sa.create_engine("sqlite:///:memory:")
    OutboxEvent.__table__.create(engine)
    Notification.__table__.create(engine)
    with sessionmaker(bind=engine)() as session:
        yield session
    Notification.__table__.drop(engine)
    OutboxEvent.__table__.drop(engine)


@pytest.fixture
def session_factory(tmp_path):
    """File-backed SQLite so each worker transaction sees the committed state."""
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'outbox.db'}")
    OutboxEvent.__table__.create(engine)
    Notification.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    yield factory
    engine.dispose()


@pytest.fixture
def seeded_event(session_factory):
    envelope = get_fixture_reported_event()
    with session_factory() as session:
        OutboxRepository(session).save_event(envelope)
        session.commit()
    return envelope


class _RecordingHandler(BaseHTTPRequestHandler):
    """Small n8n stand-in that records requests and returns a scripted status."""

    received: list[dict] = []
    response_status = 200
    response_body = b'{"status":"received","run_id":"run-abc-123"}'

    def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler API
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        type(self).received.append(
            {
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "body": body,
            }
        )
        self.send_response(type(self).response_status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(type(self).response_body)))
        self.end_headers()
        self.wfile.write(type(self).response_body)

    def log_message(self, *args):  # silence test output
        pass


@pytest.fixture
def webhook_server():
    handler = type("Handler", (_RecordingHandler,), {"received": [], "response_status": 200})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, handler
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _dispatch(session_factory, event_id):
    with session_factory() as session:
        return OutboxRepository(session).get_event(event_id)


# ---------------------------------------------------------------------------
# 1. Signed webhook delivery
# ---------------------------------------------------------------------------


def test_dispatcher_signs_body_and_headers(webhook_server, session_factory, seeded_event):
    server, handler = webhook_server
    port = server.server_address[1]
    dispatcher = WebhookDispatcher(url=f"http://127.0.0.1:{port}/webhook/events", timeout_seconds=5)

    result = dispatcher.dispatch(_dispatch(session_factory, seeded_event.event_id))

    assert result.success is True
    assert result.status_code == 200
    assert result.run_id == "run-abc-123"
    assert len(handler.received) == 1

    request = handler.received[0]
    headers = request["headers"]
    assert headers["x-cim-event-id"] == str(seeded_event.event_id)
    assert headers["content-type"] == "application/json"

    raw_body = request["body"]
    expected = calculate_signature(int(headers["x-cim-timestamp"]), raw_body, TEST_SECRET)
    assert headers["x-cim-signature"] == expected

    payload = json.loads(raw_body)
    assert payload["event_id"] == str(seeded_event.event_id)
    assert payload["incident_id"] == str(seeded_event.incident_id)
    assert payload["event_type"] == "incident.reported"
    # Envelope must never carry description/evidence/internal comments
    assert set(payload) == {
        "event_id",
        "event_type",
        "incident_id",
        "occurred_at",
        "schema_version",
        "request_id",
    }


def test_dispatcher_marks_5xx_retryable(webhook_server, session_factory, seeded_event):
    server, handler = webhook_server
    handler.response_status = 503
    dispatcher = WebhookDispatcher(url=f"http://127.0.0.1:{server.server_address[1]}/hook")

    result = dispatcher.dispatch(_dispatch(session_factory, seeded_event.event_id))

    assert result.success is False
    assert result.status_code == 503
    assert result.retryable is True


def test_dispatcher_marks_4xx_permanent(webhook_server, session_factory, seeded_event):
    server, handler = webhook_server
    handler.response_status = 400
    dispatcher = WebhookDispatcher(url=f"http://127.0.0.1:{server.server_address[1]}/hook")

    result = dispatcher.dispatch(_dispatch(session_factory, seeded_event.event_id))

    assert result.success is False
    assert result.status_code == 400
    assert result.retryable is False


def test_dispatcher_network_error_is_retryable(session_factory, seeded_event):
    # Port 1 is not listening in the test environment.
    dispatcher = WebhookDispatcher(url="http://127.0.0.1:1/webhook/events", timeout_seconds=1)

    result = dispatcher.dispatch(_dispatch(session_factory, seeded_event.event_id))

    assert result.success is False
    assert result.error_code in {"network_error", "unexpected_error"}
    assert result.retryable is True


def test_dispatcher_redacts_secret_in_error_message():
    message = f"failed calling http://user:pass@n8n.local/events with secret {TEST_SECRET}"
    cleaned = sanitize_error_message(message)
    assert TEST_SECRET not in cleaned
    assert "pass@" not in cleaned


def test_dispatcher_returns_bool_for_worker_port(webhook_server, session_factory, seeded_event):
    server, _handler = webhook_server
    dispatcher = WebhookDispatcher(url=f"http://127.0.0.1:{server.server_address[1]}/hook")

    assert dispatcher(_dispatch(session_factory, seeded_event.event_id)) is True


# ---------------------------------------------------------------------------
# 2. Worker retry / backoff / dead-letter
# ---------------------------------------------------------------------------


def test_worker_dispatch_success_marks_done(session_factory, seeded_event):
    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=lambda ev: DispatchResult(success=True, status_code=200),
        worker_id="worker-success",
    )

    counts = worker.step()

    assert counts["claimed"] == 1
    assert counts["processed"] == 1
    assert counts["failed"] == 0
    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "done"
    assert record.lease_token is None


def test_worker_retries_with_backoff_then_dead_letters(session_factory, seeded_event):
    attempts: list[uuid.UUID] = []

    def failing(ev: OutboxEvent) -> DispatchResult:
        attempts.append(ev.id)
        return DispatchResult(
            success=False,
            error_code="http_503",
            error_message="n8n unavailable",
            retryable=True,
        )

    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=failing,
        batch_size=5,
        worker_id="worker-retry",
        backoff_base_seconds=0,
    )

    with session_factory() as session:
        record = OutboxRepository(session).get_event(seeded_event.event_id)
        record.max_attempts = 3
        session.commit()

    for _ in range(3):
        worker.step()
        # Make the event eligible again immediately (backoff 0 is already due).
        with session_factory() as session:
            repo = OutboxRepository(session)
            record = repo.get_event(seeded_event.event_id)
            if record.status == "pending":
                record.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
            session.commit()

    assert len(attempts) == 3
    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "failed"
    assert record.attempt_count == 3
    assert record.next_attempt_at is None
    assert "n8n unavailable" in (record.error_message or "")


def test_worker_non_retryable_failure_goes_straight_to_dead_letter(session_factory, seeded_event):
    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=lambda ev: DispatchResult(
            success=False,
            status_code=422,
            error_code="http_422",
            error_message="n8n rejected envelope",
            retryable=False,
        ),
        worker_id="worker-reject",
    )

    counts = worker.step()

    assert counts["claimed"] == 1
    assert counts["failed"] == 0
    assert counts["dead_lettered"] == 1
    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "failed"
    assert record.attempt_count == 1


def test_worker_backoff_is_capped(session_factory, seeded_event):
    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=lambda ev: DispatchResult(success=False, error_message="boom"),
        worker_id="worker-cap",
        backoff_base_seconds=1000,
        max_backoff_seconds=300,
    )

    worker.step()

    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "pending"
    delta = record.next_attempt_at - record.last_attempt_at
    # Claim and fail take separate timestamps, so allow a small clock tolerance.
    assert delta <= timedelta(seconds=300, milliseconds=500)
    assert delta >= timedelta(seconds=0)


def test_worker_exception_in_dispatcher_does_not_crash_cycle(session_factory, seeded_event):
    def exploding(_ev: OutboxEvent) -> bool:
        raise RuntimeError("connection reset")

    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=exploding,
        worker_id="worker-explode",
    )

    counts = worker.step()

    assert counts["claimed"] == 1
    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "pending"
    assert "connection reset" in (record.error_message or "")


# ---------------------------------------------------------------------------
# 3. n8n downtime and restart recovery
# ---------------------------------------------------------------------------


def test_n8n_down_keeps_event_and_resumes_when_back(session_factory, seeded_event):
    """T14: n8n down must not lose the event; it is delivered once n8n returns."""
    delivered: list[uuid.UUID] = []
    online = {"value": False}

    def dispatcher(ev: OutboxEvent) -> DispatchResult:
        if not online["value"]:
            return DispatchResult(
                success=False,
                error_code="network_error",
                error_message="connection refused",
                retryable=True,
            )
        delivered.append(ev.id)
        return DispatchResult(success=True, status_code=200)

    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=dispatcher,
        worker_id="worker-downtime",
        backoff_base_seconds=0,
    )

    worker.step()
    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "pending"
    assert record.attempt_count == 1
    assert delivered == []

    online["value"] = True
    with session_factory() as session:
        repo = OutboxRepository(session)
        record = repo.get_event(seeded_event.event_id)
        record.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
        session.commit()

    worker.step()

    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "done"
    assert delivered == [seeded_event.event_id]


def test_restart_recovers_expired_lease_without_losing_event(session_factory, seeded_event):
    with session_factory() as session:
        repo = OutboxRepository(session)
        repo.claim_events(limit=1, worker_id="crashed-worker", now=datetime.now(UTC))
        session.commit()

    stuck = _dispatch(session_factory, seeded_event.event_id)
    assert stuck.status == "processing"
    assert stuck.attempt_count == 1

    # Simulate time passing beyond the lease, then a fresh worker starting up.
    with session_factory() as session:
        record = OutboxRepository(session).get_event(seeded_event.event_id)
        record.lease_expires_at = datetime.now(UTC) - timedelta(seconds=5)
        session.commit()

    delivered: list[uuid.UUID] = []
    restarted = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=lambda ev: delivered.append(ev.id) or True,
        worker_id="fresh-worker",
    )
    recovered = restarted.recover_interrupted_events()

    assert recovered == 1
    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "pending"
    assert record.lease_token is None

    restarted.step()

    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "done"
    assert delivered == [seeded_event.event_id]


def test_restart_does_not_steal_live_lease(session_factory, seeded_event):
    with session_factory() as session:
        OutboxRepository(session).claim_events(
            limit=1,
            worker_id="live-worker",
            lease_duration_seconds=300,
            now=datetime.now(UTC),
        )
        session.commit()

    restarted = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=lambda ev: True,
        worker_id="fresh-worker",
    )

    assert restarted.recover_interrupted_events() == 0
    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "processing"
    assert record.lease_token == "live-worker"


def test_run_once_drains_queue_and_reports_counts(session_factory, seeded_event):
    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=lambda ev: True,
        worker_id="worker-once",
    )

    counts = worker.run_once()

    assert counts == {"claimed": 1, "processed": 1, "failed": 0, "dead_lettered": 0}


def test_run_forever_exits_after_max_cycles(session_factory, seeded_event):
    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=lambda ev: True,
        worker_id="worker-loop",
        sleep=lambda _seconds: None,
    )

    worker.run_forever(poll_interval_seconds=0, max_cycles=2)

    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "done"


def test_worker_success_after_workflow_callback_does_not_double_count(
    session_factory, seeded_event
):
    """n8n may call /internal/.../complete while the worker still holds the lease."""

    def dispatcher(ev: OutboxEvent) -> DispatchResult:
        # Simulate n8n finishing the workflow through the internal API.
        with session_factory() as session:
            OutboxRepository(session).complete_event(ev.id)
            session.commit()
        return DispatchResult(success=True, status_code=200)

    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=dispatcher,
        worker_id="worker-callback",
    )

    counts = worker.step()

    assert counts["processed"] == 1
    assert counts["failed"] == 0
    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "done"
    assert record.attempt_count == 1


def test_repository_lists_failed_events_for_admin(session_factory, seeded_event):
    with session_factory() as session:
        repo = OutboxRepository(session)
        record = repo.get_event(seeded_event.event_id)
        record.status = "failed"
        record.error_message = "n8n rejected envelope"
        session.commit()

        failed = repo.list_failed_events(limit=10)

    assert [ev.id for ev in failed] == [seeded_event.event_id]
    assert failed[0].error_message == "n8n rejected envelope"


def test_worker_retry_dead_letter_requeues_event(session_factory, seeded_event):
    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=lambda ev: DispatchResult(success=False, error_message="boom", retryable=False),
        worker_id="worker-admin",
    )
    worker.step()
    assert _dispatch(session_factory, seeded_event.event_id).status == "failed"

    assert worker.retry_dead_letter(seeded_event.event_id, reason="n8n fixed") is True

    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "pending"
    assert record.attempt_count == 0
    assert "Admin retry: n8n fixed" in (record.error_message or "")


def test_dispatcher_output_verifies_with_backend_verifier(
    webhook_server, session_factory, seeded_event
):
    """The receiving side (n8n or verify_webhook_request) must accept our signature."""
    server, handler = webhook_server
    dispatcher = WebhookDispatcher(url=f"http://127.0.0.1:{server.server_address[1]}/hook")

    dispatcher.dispatch(_dispatch(session_factory, seeded_event.event_id))

    request = handler.received[0]
    result = verify_webhook_request(
        headers=request["headers"],
        raw_body=request["body"],
        secret=TEST_SECRET,
    )
    assert result.is_valid is True
    assert result.event_id == seeded_event.event_id


def test_dispatcher_falls_back_to_columns_when_payload_missing(
    webhook_server, session_factory, seeded_event
):
    server, handler = webhook_server
    event = OutboxEvent(
        id=seeded_event.event_id,
        event_type=seeded_event.event_type.value,
        incident_id=seeded_event.incident_id,
        request_id=seeded_event.request_id,
        occurred_at=seeded_event.occurred_at,
        schema_version=1,
        payload=None,
    )
    dispatcher = WebhookDispatcher(url=f"http://127.0.0.1:{server.server_address[1]}/hook")

    assert dispatcher.dispatch(event).success is True

    payload = json.loads(handler.received[0]["body"])
    assert payload["occurred_at"] == "2026-11-02T09:30:00Z"
    assert payload["schema_version"] == 1


def test_dispatcher_rejects_oversized_payload(session_factory, seeded_event):
    event = OutboxEvent(
        id=seeded_event.event_id,
        event_type=seeded_event.event_type.value,
        incident_id=seeded_event.incident_id,
        request_id=seeded_event.request_id,
        occurred_at=seeded_event.occurred_at,
        schema_version=1,
        payload={"event_id": str(seeded_event.event_id), "padding": "x" * 20_000},
    )
    dispatcher = WebhookDispatcher(url="http://127.0.0.1:1/hook")

    result = dispatcher.dispatch(event)

    assert result.success is False
    assert result.error_code == "payload_too_large"
    assert result.retryable is False


def test_worker_marks_event_done_once_under_repeated_dispatch(session_factory, seeded_event):
    """At-least-once delivery: the same event_id may arrive twice at n8n."""
    seen: list[str] = []

    def dispatcher(ev: OutboxEvent) -> DispatchResult:
        seen.append(str(ev.id))
        return DispatchResult(success=True)

    worker = OutboxWorkerStub(
        session_factory=session_factory,
        dispatcher=dispatcher,
        worker_id="worker-idem",
    )

    worker.step()
    worker.step()  # nothing left to claim

    assert seen == [str(seeded_event.event_id)]
    record = _dispatch(session_factory, seeded_event.event_id)
    assert record.status == "done"
    assert record.attempt_count == 1


def test_worker_from_settings_uses_configured_webhook(
    webhook_server, session_factory, seeded_event
):
    server, handler = webhook_server
    settings = OutboxSettings(
        webhook_url=f"http://127.0.0.1:{server.server_address[1]}/webhook/events",
        timeout_seconds=5,
        batch_size=5,
        worker_id="worker-config",
    )

    worker = OutboxWorkerStub.from_settings(session_factory=session_factory, settings=settings)
    counts = worker.step()

    assert counts["processed"] == 1
    assert len(handler.received) == 1
    assert handler.received[0]["headers"]["x-cim-event-id"] == str(seeded_event.event_id)


def test_outbox_settings_reads_environment(monkeypatch):
    monkeypatch.setenv("N8N_WEBHOOK_URL", "http://n8n:5678/webhook/events")
    monkeypatch.setenv("CIM_OUTBOX_BATCH_SIZE", "25")
    monkeypatch.setenv("CIM_OUTBOX_LEASE_SECONDS", "90")
    monkeypatch.setenv("CIM_OUTBOX_DISPATCH_ENABLED", "false")

    settings = OutboxSettings.from_env()

    assert settings.webhook_url == "http://n8n:5678/webhook/events"
    assert settings.batch_size == 25
    assert settings.lease_duration_seconds == 90
    assert settings.enabled is False


def test_outbox_settings_ignores_invalid_numbers(monkeypatch):
    monkeypatch.setenv("CIM_OUTBOX_BATCH_SIZE", "not-a-number")

    settings = OutboxSettings.from_env()

    assert settings.batch_size == 10


def test_configured_secret_used_for_signing(webhook_secret_env):
    assert get_configured_webhook_secrets()[0] == TEST_SECRET.encode()


# ---------------------------------------------------------------------------
# 4. CLI entry point
# ---------------------------------------------------------------------------


class _FakeWorker:
    def __init__(self, counts: dict[str, int] | None = None, recovered: int = 0) -> None:
        self.counts = counts or {"claimed": 0, "processed": 0, "failed": 0, "dead_lettered": 0}
        self.recovered = recovered
        self.called: list[str] = []

    def recover_interrupted_events(self, now=None) -> int:
        self.called.append("recover")
        return self.recovered

    def run_once(self) -> dict[str, int]:
        self.called.append("once")
        return self.counts

    def run_forever(self, **kwargs) -> None:
        self.called.append("forever")


def test_run_worker_main_recover(monkeypatch):
    fake = _FakeWorker(recovered=2)
    monkeypatch.setattr(run_worker, "build_worker", lambda settings: fake)
    monkeypatch.delenv("CIM_OUTBOX_DISPATCH_ENABLED", raising=False)

    exit_code = run_worker.main(["--recover"])

    assert exit_code == 0
    assert fake.called == ["recover"]


def test_run_worker_main_once_returns_nonzero_on_failure(monkeypatch):
    fake = _FakeWorker(
        counts={"claimed": 1, "processed": 0, "failed": 0, "dead_lettered": 1},
    )
    monkeypatch.setattr(run_worker, "build_worker", lambda settings: fake)
    monkeypatch.delenv("CIM_OUTBOX_DISPATCH_ENABLED", raising=False)

    assert run_worker.main(["--once"]) == 1
    assert fake.called == ["once"]


def test_run_worker_main_respects_disable_flag(monkeypatch):
    monkeypatch.setenv("CIM_OUTBOX_DISPATCH_ENABLED", "false")
    monkeypatch.setattr(
        run_worker, "build_worker", lambda settings: pytest.fail("worker must not be built")
    )

    assert run_worker.main([]) == 0
