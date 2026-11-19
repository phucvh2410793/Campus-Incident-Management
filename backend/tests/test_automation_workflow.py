"""N5 W5 workflow contract tests.

The n8n workflow in ``workflows/event-processor.json`` is orchestration only:
it forwards the raw webhook body to the backend verifier, skips events that
were already completed, then calls ``/internal/events/{id}/evaluate`` and
``/internal/events/{id}/complete``. These tests execute the same contract
against the real FastAPI routes with a signed envelope, so the acceptance
criteria are covered without requiring a running n8n instance:

- forged event (bad signature) is rejected and does not mutate the outbox;
- expired/future timestamp is rejected;
- duplicate delivery is detected and does not re-evaluate;
- every accepted response carries a run ID.
"""

import json
import time
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.models import Session as UserSession
from app.automation.fixtures import SAMPLE_INCIDENT_ID, SAMPLE_REQUEST_ID
from app.automation.models import Notification, OutboxEvent
from app.automation.publisher import InMemoryEventPublisher, set_event_publisher
from app.automation.repository import OutboxRepository
from app.automation.router import _IN_MEMORY_EVALUATIONS
from app.automation.schemas import EventEnvelope, EventType
from app.automation.security import build_webhook_headers
from app.automation.service_auth import (
    DEFAULT_DEMO_SERVICE_TOKEN,
    clear_test_user_tokens,
    get_optional_db,
    token_manager,
)
from app.main import app

VALID_SERVICE_TOKEN = DEFAULT_DEMO_SERVICE_TOKEN
TEST_SECRET = "w5-workflow-hmac-secret-4c1e"
WORKFLOW_PATH = Path(__file__).resolve().parents[2] / "workflows" / "event-processor.json"
SERVICE_HEADERS = {"Authorization": f"Bearer {VALID_SERVICE_TOKEN}"}


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch):
    """Use test-only secrets and reset every module-level singleton."""
    monkeypatch.setenv("CIM_WEBHOOK_HMAC_SECRET", TEST_SECRET)
    monkeypatch.delenv("CIM_WEBHOOK_HMAC_SECRETS_ROTATION", raising=False)
    monkeypatch.delenv("CIM_INTERNAL_SERVICE_BEARER_TOKENS", raising=False)
    monkeypatch.delenv("CIM_INTERNAL_SERVICE_TOKEN_HASHES", raising=False)

    token_manager.reset()
    clear_test_user_tokens()
    _IN_MEMORY_EVALUATIONS.clear()
    set_event_publisher(InMemoryEventPublisher())
    yield
    token_manager.reset()
    clear_test_user_tokens()
    _IN_MEMORY_EVALUATIONS.clear()


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


def _seed_event(db: Session, event_id: uuid.UUID | None = None) -> tuple[uuid.UUID, bytes]:
    """Persist an outbox event and return the exact bytes a dispatcher signs."""
    envelope = EventEnvelope(
        event_id=event_id or uuid.uuid4(),
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    OutboxRepository(db).save_event(envelope)
    db.commit()

    raw_body = json.dumps(
        envelope.model_dump(mode="json"),
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return envelope.event_id, raw_body


def _signed_headers(
    event_id: uuid.UUID,
    raw_body: bytes,
    *,
    timestamp: int | None = None,
    secret: str = TEST_SECRET,
) -> dict[str, str]:
    return build_webhook_headers(event_id, raw_body, secret, timestamp=timestamp)


def _event_status(db: Session, event_id: uuid.UUID) -> str:
    db.expire_all()
    record = OutboxRepository(db).get_event(event_id)
    assert record is not None
    return record.status


def run_workflow(
    client: TestClient,
    headers: dict[str, str],
    raw_body: bytes,
    *,
    run_id: str,
) -> dict:
    """Mirror the n8n node sequence in ``event-processor.json``."""
    verification = client.post(
        "/internal/webhooks/verify",
        content=raw_body,
        headers={**headers, **SERVICE_HEADERS},
    )
    if verification.status_code != 200:
        return {
            "status": "rejected",
            "http_status": verification.status_code,
            "run_id": run_id,
            "detail": verification.json()["detail"],
        }

    event_id = uuid.UUID(headers["X-CIM-Event-ID"])
    metadata = client.get(f"/internal/events/{event_id}", headers=SERVICE_HEADERS)
    if metadata.status_code != 200:
        return {
            "status": "failed",
            "http_status": metadata.status_code,
            "run_id": run_id,
            "event_id": str(event_id),
        }

    if metadata.json()["status"] == "done":
        return {
            "status": "duplicate",
            "duplicate": True,
            "run_id": run_id,
            "event_id": str(event_id),
        }

    evaluation = client.post(
        f"/internal/events/{event_id}/evaluate",
        json={"run_id": run_id},
        headers=SERVICE_HEADERS,
    )
    if evaluation.status_code != 200:
        client.post(
            f"/internal/events/{event_id}/complete",
            json={"run_id": run_id, "status": "failed", "error_code": "evaluate_failed"},
            headers=SERVICE_HEADERS,
        )
        return {
            "status": "failed",
            "http_status": evaluation.status_code,
            "run_id": run_id,
            "event_id": str(event_id),
        }

    completion = client.post(
        f"/internal/events/{event_id}/complete",
        json={"run_id": run_id, "status": "done"},
        headers=SERVICE_HEADERS,
    )
    assert completion.status_code == 200, completion.text

    return {
        "status": "processed",
        "duplicate": False,
        "run_id": run_id,
        "event_id": str(event_id),
        "evaluation": evaluation.json(),
    }


# ---------------------------------------------------------------------------
# 1. Accepted event: verify -> evaluate -> complete, response has run ID
# ---------------------------------------------------------------------------


def test_workflow_processes_signed_event_and_returns_run_id(
    client: TestClient, db_session: Session
):
    event_id, raw_body = _seed_event(db_session)
    headers = _signed_headers(event_id, raw_body)

    result = run_workflow(client, headers, raw_body, run_id="n8n-run-w5-001")

    assert result["status"] == "processed"
    assert result["duplicate"] is False
    assert result["run_id"] == "n8n-run-w5-001"
    assert result["event_id"] == str(event_id)
    assert result["evaluation"]["incident_id"] == str(SAMPLE_INCIDENT_ID)
    assert result["evaluation"]["rule_id"] == "demo-v1"
    assert _event_status(db_session, event_id) == "done"


def test_workflow_returns_identical_evaluation_for_repeated_calls(
    client: TestClient, db_session: Session
):
    """Repeating evaluate for the same event stays idempotent at the API layer."""
    event_id, _raw_body = _seed_event(db_session)

    first = client.post(
        f"/internal/events/{event_id}/evaluate",
        json={"run_id": "run-a"},
        headers=SERVICE_HEADERS,
    )
    second = client.post(
        f"/internal/events/{event_id}/evaluate",
        json={"run_id": "run-b"},
        headers=SERVICE_HEADERS,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()


# ---------------------------------------------------------------------------
# 2. Forged / expired / future events are rejected without side effects
# ---------------------------------------------------------------------------


def test_workflow_rejects_forged_signature(client: TestClient, db_session: Session):
    event_id, raw_body = _seed_event(db_session)
    headers = _signed_headers(event_id, raw_body)
    forged_body = raw_body.replace(b"incident.reported", b"incident.assigned")

    result = run_workflow(client, headers, forged_body, run_id="run-forged")

    assert result["status"] == "rejected"
    assert result["http_status"] == 401
    assert result["run_id"] == "run-forged"
    assert "Chữ ký" in result["detail"]
    assert _event_status(db_session, event_id) == "pending"
    assert _IN_MEMORY_EVALUATIONS == {}


def test_workflow_rejects_expired_timestamp(client: TestClient, db_session: Session):
    event_id, raw_body = _seed_event(db_session)
    headers = _signed_headers(event_id, raw_body, timestamp=int(time.time()) - 301)

    result = run_workflow(client, headers, raw_body, run_id="run-expired")

    assert result["status"] == "rejected"
    assert result["http_status"] == 401
    assert "quá hạn" in result["detail"]
    assert _event_status(db_session, event_id) == "pending"


def test_workflow_rejects_future_timestamp(client: TestClient, db_session: Session):
    event_id, raw_body = _seed_event(db_session)
    headers = _signed_headers(event_id, raw_body, timestamp=int(time.time()) + 301)

    result = run_workflow(client, headers, raw_body, run_id="run-future")

    assert result["status"] == "rejected"
    assert result["http_status"] == 401
    assert "tương lai" in result["detail"]
    assert _event_status(db_session, event_id) == "pending"


def test_workflow_rejects_malformed_event_id(client: TestClient):
    raw_body = b'{"event_id":"not-a-uuid"}'
    headers = {
        "X-CIM-Event-ID": "not-a-uuid",
        "X-CIM-Timestamp": str(int(time.time())),
        "X-CIM-Signature": "sha256=placeholder",
    }

    verification = client.post(
        "/internal/webhooks/verify",
        content=raw_body,
        headers={**headers, **SERVICE_HEADERS},
    )

    assert verification.status_code == 422
    assert "UUID" in verification.json()["detail"]


# ---------------------------------------------------------------------------
# 3. Duplicate delivery: done event is skipped, not evaluated twice
# ---------------------------------------------------------------------------


def test_workflow_skips_duplicate_delivery_without_reevaluating(
    client: TestClient, db_session: Session
):
    event_id, raw_body = _seed_event(db_session)
    headers = _signed_headers(event_id, raw_body)

    first = run_workflow(client, headers, raw_body, run_id="run-first")
    assert first["status"] == "processed"

    # Prove the duplicate branch does not call evaluate: clear the cache and make
    # sure it stays empty while the event is already marked done.
    _IN_MEMORY_EVALUATIONS.clear()

    duplicate = run_workflow(client, headers, raw_body, run_id="run-second")

    assert duplicate["status"] == "duplicate"
    assert duplicate["duplicate"] is True
    assert duplicate["run_id"] == "run-second"
    assert duplicate["event_id"] == str(event_id)
    assert _IN_MEMORY_EVALUATIONS == {}
    assert _event_status(db_session, event_id) == "done"


# ---------------------------------------------------------------------------
# 4. Workflow artifact contract (importable n8n JSON)
# ---------------------------------------------------------------------------


def test_event_processor_workflow_has_verification_duplicate_and_run_id():
    workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))
    nodes = {node["name"]: node for node in workflow["nodes"]}

    assert workflow["id"] == "CIMEventProcessor001"
    assert workflow["active"] is False
    assert nodes["Webhook Receiver"]["parameters"]["options"]["rawBody"] is True

    http_parameters = [
        node["parameters"]
        for node in workflow["nodes"]
        if node["type"] == "n8n-nodes-base.httpRequest"
    ]
    urls = " ".join(parameters.get("url", "") for parameters in http_parameters)
    assert "/internal/webhooks/verify" in urls
    assert "/internal/events/" in urls
    assert "/evaluate" in urls
    assert "/complete" in urls
    for parameters in http_parameters:
        # n8n 2.x denies $env in expressions, so the compose URL is literal and
        # the leading "=" is what enables the per-event expression in the path.
        assert parameters["url"].startswith("=http://backend:8000/internal/")

    verify_node = nodes["Verify Signature"]
    assert verify_node["parameters"]["contentType"] == "binaryData"
    assert verify_node["parameters"]["inputDataFieldName"] == "data"

    raw_text = WORKFLOW_PATH.read_text(encoding="utf-8")
    assert "$execution.id" in raw_text
    assert "run_id" in raw_text
    assert "sk-live" not in raw_text
    assert TEST_SECRET not in raw_text
    assert "Bearer " not in raw_text
    assert "$env." not in raw_text

    for name in ("Signature Valid?", "Already Processed?", "Evaluation Succeeded?"):
        assert nodes[name]["type"] == "n8n-nodes-base.if"
    for name in (
        "Respond Rejected",
        "Respond Duplicate",
        "Respond Processed",
        "Respond Evaluation Failed",
    ):
        assert nodes[name]["type"] == "n8n-nodes-base.respondToWebhook"

    # Every non-responder node has an outgoing connection in the workflow graph.
    outgoing = set(workflow["connections"])
    respond_nodes = {
        name
        for name, node in nodes.items()
        if node["type"] == "n8n-nodes-base.respondToWebhook"
    }
    assert set(nodes) - respond_nodes == outgoing
