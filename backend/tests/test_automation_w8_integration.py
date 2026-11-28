"""N5 W8 integration tests: End-to-end MVP incidents, real events and scheduled SLA check.

Acceptance criteria (W8 · 30/11/2026-06/12/2026):
1. Three MVP incident cases (water_leak, electrical_hazard, phishing) traverse
   backend -> n8n -> backend:
   - Backend commits incident and records outbox event (incident.reported).
   - Worker claims event and dispatches signed envelope with HMAC-SHA256 headers.
   - n8n webhook verifies signature via /internal/webhooks/verify.
   - n8n evaluates incident via /internal/events/{id}/evaluate using N3 rule engine.
   - Backend updates incident severity, priority, department and evaluation metadata.
   - n8n marks event completed via /internal/events/{id}/complete.
2. Real domain events from N3 and N4:
   - incident.assigned (N4) dispatched and completed.
   - incident.priority_changed (N4) dispatched and completed.
   - sla.escalated (N3) dispatched and completed.
3. Schedule SLA check:
   - Periodic review at /internal/sla/check evaluates overdue incidents.
   - Escalates overdue unacknowledged incidents and emits sla.escalated.
   - Strictly enforces "SLA báo một lần/mức" (alerts exactly once per level).
   - Subsequent checks on overdue incidents do not duplicate escalations.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.models import Session as UserSession
from app.auth.seed_demo import DEMO_DEPARTMENTS
from app.automation.fixtures import SAMPLE_REQUEST_ID
from app.automation.models import Notification, OutboxEvent
from app.automation.publisher import (
    InMemoryEventPublisher,
    OutboxEventPublisher,
    set_event_publisher,
)
from app.automation.repository import OutboxRepository
from app.automation.router import _IN_MEMORY_EVALUATIONS
from app.automation.run_worker import main as run_worker_main
from app.automation.schemas import EventEnvelope, EventType
from app.automation.security import build_webhook_headers
from app.automation.service_auth import (
    DEFAULT_DEMO_SERVICE_TOKEN,
    clear_test_user_tokens,
    get_optional_db,
    token_manager,
)
from app.automation.worker import OutboxWorkerStub
from app.incidents.models import Incident
from app.main import app
from app.models import Department, User
from app.sla.models import Escalation

TEST_SECRET = "w8-integration-hmac-secret-99f1"
SERVICE_HEADERS = {"Authorization": f"Bearer {DEFAULT_DEMO_SERVICE_TOKEN}"}
SLA_WORKFLOW_PATH = Path(__file__).resolve().parents[2] / "workflows" / "sla-check.json"


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch):
    """Use test-only secrets and reset module-level singletons."""
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
    from sqlalchemy import event

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(Incident, "load")
    def receive_incident_load(target, context):
        if target.reported_at and target.reported_at.tzinfo is None:
            target.reported_at = target.reported_at.replace(tzinfo=UTC)
        if target.acknowledgment_deadline_at and target.acknowledgment_deadline_at.tzinfo is None:
            target.acknowledgment_deadline_at = target.acknowledgment_deadline_at.replace(
                tzinfo=UTC
            )

    @event.listens_for(Escalation, "load")
    def receive_escalation_load(target, context):
        if target.deadline_at and target.deadline_at.tzinfo is None:
            target.deadline_at = target.deadline_at.replace(tzinfo=UTC)
        if target.escalated_at and target.escalated_at.tzinfo is None:
            target.escalated_at = target.escalated_at.replace(tzinfo=UTC)

    with engine.connect() as connection:
        connection.connection.driver_connection.create_function(
            "jsonb_typeof",
            1,
            lambda value: "object" if isinstance(json.loads(value), dict) else "array",
        )
        Department.__table__.create(connection)
        User.__table__.create(connection)
        Incident.__table__.create(connection)
        Escalation.__table__.create(connection)
        OutboxEvent.__table__.create(connection)
        Notification.__table__.create(connection)
        UserSession.__table__.create(connection)
        connection.commit()

    yield engine

    with engine.connect() as connection:
        UserSession.__table__.drop(connection)
        Notification.__table__.drop(connection)
        OutboxEvent.__table__.drop(connection)
        Escalation.__table__.drop(connection)
        Incident.__table__.drop(connection)
        User.__table__.drop(connection)
        Department.__table__.drop(connection)
        connection.commit()


@pytest.fixture
def session_factory(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture
def db_session(session_factory):
    with session_factory() as session:
        # Seed standard departments
        for dept_id, name in DEMO_DEPARTMENTS:
            session.add(Department(id=dept_id, name=name))
        # Seed test reporter user
        reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
        session.add(
            User(
                id=reporter_id,
                email="reporter@demo.invalid",
                display_name="Demo Reporter",
                role="reporter",
                password_hash="demo_password_hash_123456",
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


def _simulate_n8n_processing(
    client: TestClient, headers: dict[str, str], raw_body: bytes, run_id: str
) -> dict:
    """Simulate n8n event-processor.json workflow pipeline:
    1. POST /internal/webhooks/verify
    2. GET /internal/events/{id}
    3. POST /internal/events/{id}/evaluate
    4. POST /internal/events/{id}/complete
    """
    event_data = json.loads(raw_body)
    event_id = event_data["event_id"]

    # 1. Verify
    verify_resp = client.post(
        "/internal/webhooks/verify",
        data=raw_body,
        headers={**SERVICE_HEADERS, **headers, "Content-Type": "application/json"},
    )
    if verify_resp.status_code != 200:
        return {"status": "rejected", "code": verify_resp.status_code, "run_id": run_id}

    # 2. Duplicate Check
    get_resp = client.get(f"/internal/events/{event_id}", headers=SERVICE_HEADERS)
    if get_resp.status_code == 200 and get_resp.json().get("status") == "done":
        return {"status": "duplicate", "duplicate": True, "run_id": run_id}

    # 3. Evaluate
    eval_resp = client.post(
        f"/internal/events/{event_id}/evaluate",
        json={"run_id": run_id},
        headers=SERVICE_HEADERS,
    )
    if eval_resp.status_code != 200:
        client.post(
            f"/internal/events/{event_id}/complete",
            json={"run_id": run_id, "status": "failed", "error_code": "eval_error"},
            headers=SERVICE_HEADERS,
        )
        return {"status": "failed", "code": eval_resp.status_code, "run_id": run_id}

    # 4. Complete
    complete_resp = client.post(
        f"/internal/events/{event_id}/complete",
        json={"run_id": run_id, "status": "done"},
        headers=SERVICE_HEADERS,
    )
    assert complete_resp.status_code == 200

    return {
        "status": "processed",
        "duplicate": False,
        "run_id": run_id,
        "evaluation": eval_resp.json(),
        "completion": complete_resp.json(),
    }


# ===========================================================================
# 1. Ba ca MVP đi xuyên backend -> n8n -> backend
# ===========================================================================


def test_w8_mvp_water_leak_end_to_end(client: TestClient, db_session: Session, session_factory):
    """MVP 1: Rò nước (water_leak) gần điện -> R03 -> P1 Cơ sở vật chất."""
    reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    now = datetime.now(UTC)

    # 1. Backend creates incident and publishes outbox event
    incident = Incident(
        reporter_id=reporter_id,
        category="water_leak",
        title="Rò rỉ nước tầng 2 gần bảng điện",
        description="Phát hiện vũng nước lớn lan gần tủ điện hành lang tòa nhà A",
        building="Tòa nhà A",
        answers={"near_electricity": "yes", "leak_amount": "large"},
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
        occurred_at=now,
    )
    event_id = envelope.event_id
    db_session.commit()

    # 2. Worker claims and signs event
    repo = OutboxRepository(db_session)
    ev = repo.get_event(event_id)
    assert ev is not None
    assert ev.status == "pending"

    raw_body = json.dumps(
        {
            "event_id": str(ev.id),
            "event_type": ev.event_type,
            "incident_id": str(ev.incident_id),
            "occurred_at": ev.occurred_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "schema_version": 1,
            "request_id": str(SAMPLE_REQUEST_ID),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    headers = build_webhook_headers(ev.id, raw_body, TEST_SECRET)

    # 3. Simulate n8n workflow execution
    result = _simulate_n8n_processing(client, headers, raw_body, run_id="n8n-w8-water-001")

    assert result["status"] == "processed"
    assert result["run_id"] == "n8n-w8-water-001"
    evaluation = result["evaluation"]
    assert evaluation["incident_id"] == str(incident.id)
    assert evaluation["priority"] == "P1"
    assert evaluation["severity"] == "high"
    assert evaluation["rule_id"] == "R03"
    assert "Cơ sở vật chất" in evaluation["reason"] or evaluation["department_id"] is not None

    # 4. Verify DB state updated
    db_session.refresh(incident)
    assert incident.priority == "p1"
    assert incident.severity == "high"
    assert incident.rule_evaluation["rule_id"] == "R03"

    db_session.refresh(ev)
    assert ev.status == "done"

    # 5. Idempotent check
    dup_result = _simulate_n8n_processing(client, headers, raw_body, run_id="n8n-w8-water-002")
    assert dup_result["status"] == "duplicate"


def test_w8_evaluation_failure_does_not_report_demo_success(
    client: TestClient, db_session: Session, monkeypatch
):
    incident = Incident(
        reporter_id=uuid.UUID("10000000-0000-4000-8000-000000000001"),
        category="water_leak",
        title="Water leak near the electrical room",
        description="A large leak was found near the electrical room on campus.",
        building="Building A",
        answers={"near_electricity": "yes"},
    )
    db_session.add(incident)
    db_session.flush()
    event = OutboxEventPublisher(db_session).create_and_publish(
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=incident.id,
        request_id=SAMPLE_REQUEST_ID,
    )
    db_session.commit()

    def fail_evaluation(*args, **kwargs):
        raise RuntimeError("rule engine unavailable")

    monkeypatch.setattr("app.rules.engine.evaluate_incident", fail_evaluation)
    response = client.post(
        f"/internal/events/{event.event_id}/evaluate",
        json={"run_id": "failed-evaluation"},
        headers=SERVICE_HEADERS,
    )
    assert response.status_code == 503
    db_session.refresh(incident)
    assert incident.rule_evaluation is None


def test_w8_mvp_electrical_hazard_end_to_end(client: TestClient, db_session: Session):
    """MVP 2: Nguy hiểm điện (electrical_hazard) có khói/tia lửa -> R01 -> P1 Điện và an toàn."""
    reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    now = datetime.now(UTC)

    incident = Incident(
        reporter_id=reporter_id,
        category="electrical_hazard",
        title="Ổ cắm bốc khói và tia lửa điện",
        description="Ổ cắm tại phòng học B102 phát ra tiếng nổ lách tách và khói đen",
        building="Tòa nhà B",
        answers={"smoke_or_sparks": "yes", "exposed_wire": "no"},
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
        occurred_at=now,
    )
    event_id = envelope.event_id
    db_session.commit()

    repo = OutboxRepository(db_session)
    ev = repo.get_event(event_id)
    assert ev.status == "pending"

    raw_body = json.dumps(
        {
            "event_id": str(ev.id),
            "event_type": ev.event_type,
            "incident_id": str(ev.incident_id),
            "occurred_at": ev.occurred_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "schema_version": 1,
            "request_id": str(SAMPLE_REQUEST_ID),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    headers = build_webhook_headers(ev.id, raw_body, TEST_SECRET)

    result = _simulate_n8n_processing(client, headers, raw_body, run_id="n8n-w8-elec-001")

    assert result["status"] == "processed"
    evaluation = result["evaluation"]
    assert evaluation["priority"] == "P1"
    assert evaluation["severity"] == "critical"
    assert evaluation["rule_id"] == "R01"

    db_session.refresh(incident)
    assert incident.priority == "p1"
    assert incident.severity == "critical"
    assert incident.rule_evaluation["rule_id"] == "R01"


def test_w8_mvp_phishing_end_to_end(client: TestClient, db_session: Session):
    """MVP 3: Lừa đảo (phishing) đã nhập thông tin -> R02 -> P1 IT/Security."""
    reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    now = datetime.now(UTC)

    incident = Incident(
        reporter_id=reporter_id,
        category="phishing",
        title="Email giả mạo phòng đào tạo yêu cầu xác nhận mật khẩu",
        description="Đã nhận email có đường link lạ và lỡ bấm vào nhập tài khoản sinh viên",
        building="Thư viện trung tâm",
        answers={"interaction": "entered_information"},
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
        occurred_at=now,
    )
    event_id = envelope.event_id
    db_session.commit()

    repo = OutboxRepository(db_session)
    ev = repo.get_event(event_id)

    raw_body = json.dumps(
        {
            "event_id": str(ev.id),
            "event_type": ev.event_type,
            "incident_id": str(ev.incident_id),
            "occurred_at": ev.occurred_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "schema_version": 1,
            "request_id": str(SAMPLE_REQUEST_ID),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    headers = build_webhook_headers(ev.id, raw_body, TEST_SECRET)

    result = _simulate_n8n_processing(client, headers, raw_body, run_id="n8n-w8-phish-001")

    assert result["status"] == "processed"
    evaluation = result["evaluation"]
    assert evaluation["priority"] == "P1"
    assert evaluation["severity"] == "high"
    assert evaluation["rule_id"] == "R02"

    db_session.refresh(incident)
    assert incident.priority == "p1"
    assert incident.rule_evaluation["rule_id"] == "R02"


# ===========================================================================
# 2. Ghép event thật từ N3 và N4 (assigned, priority_changed, sla.escalated)
# ===========================================================================


def test_w8_domain_events_dispatch_and_complete(client: TestClient, db_session: Session):
    """Verify real domain events incident.assigned, incident.priority_changed, sla.escalated."""
    now = datetime.now(UTC)
    incident_id = uuid.uuid4()

    event_types = [
        EventType.INCIDENT_ASSIGNED,
        EventType.INCIDENT_PRIORITY_CHANGED,
        EventType.SLA_ESCALATED,
    ]

    for ev_type in event_types:
        ev_id = uuid.uuid4()
        envelope = EventEnvelope(
            event_id=ev_id,
            event_type=ev_type,
            incident_id=incident_id,
            request_id=SAMPLE_REQUEST_ID,
            occurred_at=now,
        )
        OutboxRepository(db_session).save_event(envelope)
        db_session.commit()

        raw_body = json.dumps(envelope.model_dump(mode="json"), separators=(",", ":")).encode(
            "utf-8"
        )
        headers = build_webhook_headers(ev_id, raw_body, TEST_SECRET)

        # 1. Verify endpoint succeeds
        v = client.post(
            "/internal/webhooks/verify",
            data=raw_body,
            headers={**SERVICE_HEADERS, **headers, "Content-Type": "application/json"},
        )
        assert v.status_code == 200
        assert v.json()["status"] == "verified"

        # 2. Complete endpoint completes event
        c = client.post(
            f"/internal/events/{ev_id}/complete",
            json={"run_id": f"run-{ev_type}", "status": "done"},
            headers=SERVICE_HEADERS,
        )
        assert c.status_code == 200
        assert c.json()["status"] == "done"

        # Check in DB
        ev_record = OutboxRepository(db_session).get_event(ev_id)
        assert ev_record.status == "done"


# ===========================================================================
# 3. Schedule SLA check & SLA báo một lần/mức
# ===========================================================================


def test_w8_scheduled_sla_check_escalates_once_per_level(
    client: TestClient, db_session: Session, session_factory
):
    """SLA check identifies overdue incidents and escalates exactly once per level."""
    reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    now = datetime.now(UTC)

    # Create an unacknowledged P1 incident that was reported 2 hours ago
    reported_past = now - timedelta(hours=2)
    deadline_past = reported_past + timedelta(minutes=15)  # P1 deadline 15 mins

    incident = Incident(
        reporter_id=reporter_id,
        category="electrical_hazard",
        title="Quá hạn tiếp nhận P1",
        description="Sự cố nguy hiểm điện chưa có kỹ thuật viên tiếp nhận xử lý",
        building="Tòa C",
        answers={"smoke_or_sparks": "yes"},
        reported_at=reported_past,
        priority="p1",
        severity="critical",
        status="reported",
        acknowledgment_deadline_at=deadline_past,
        escalation_level=0,
    )
    db_session.add(incident)
    db_session.commit()

    # 1. Call /internal/sla/check endpoint (scheduled n8n job trigger)
    res1 = client.post("/internal/sla/check", headers=SERVICE_HEADERS)
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["checked_count"] >= 1
    assert data1["escalations_created"] == 1

    # Verify escalation row created and outbox event emitted
    db_session.refresh(incident)
    assert incident.escalation_level == 1

    events = (
        db_session.query(OutboxEvent)
        .filter(OutboxEvent.event_type == EventType.SLA_ESCALATED)
        .all()
    )
    assert len(events) == 1
    escalated_event = events[0]
    assert escalated_event.incident_id == incident.id
    assert escalated_event.status == "pending"

    # 2. Rule: "SLA báo một lần/mức" - repeating check must NOT create duplicate escalation
    res2 = client.post("/internal/sla/check", headers=SERVICE_HEADERS)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["escalations_created"] == 0  # Crucial: 0 new escalations!

    # Verify no second event created
    events_after = (
        db_session.query(OutboxEvent)
        .filter(OutboxEvent.event_type == EventType.SLA_ESCALATED)
        .all()
    )
    assert len(events_after) == 1

    # 3. Outbox worker dispatches the sla.escalated event
    worker = OutboxWorkerStub(session_factory=session_factory)
    cycle = worker.run_cycle()
    assert cycle.claimed >= 1
    assert cycle.processed >= 1

    db_session.refresh(escalated_event)
    assert escalated_event.status == "done"


def test_w8_run_worker_cli_check_sla_flag(monkeypatch, session_factory):
    """Test CLI option --check-sla triggers SLA check cleanly."""
    import app.automation.run_worker as rw

    monkeypatch.setattr(rw, "SessionLocal", session_factory)
    exit_code = run_worker_main(["--check-sla"])
    assert exit_code == 0


def test_w8_sla_workflow_file_validity():
    """Verify workflows/sla-check.json is well-formed n8n workflow."""
    assert SLA_WORKFLOW_PATH.exists()
    content = json.loads(SLA_WORKFLOW_PATH.read_text(encoding="utf-8"))
    assert content["name"] == "Campus Incident Management - SLA Schedule Check (N5 W8)"
    node_names = [n["name"] for n in content["nodes"]]
    assert "Schedule Trigger" in node_names
    assert "Check Overdue SLA" in node_names
    assert "Escalations Created?" in node_names
