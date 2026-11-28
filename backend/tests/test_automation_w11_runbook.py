"""N5 W11 acceptance tests: Runbook, clean workflow import, credentials isolation,
dead-letter queue inspection, crash recovery, and mock email verification.

Acceptance criteria (W11 · 21/12/2026–27/12/2026):
1. Comprehensive Runbook:
   - Documented clean n8n setup, credentials outside Git, 4 workflows, DLQ inspection,
     and recovery procedures.
2. 4 Standard Workflows integrity:
   - Valid JSON, proper IDs (CIMHealthCheck001, CIMEventProcessor001,
     CIMNotificationProcessor001, CIMSlaScheduleCheck001), correct triggers and nodes.
   - Standard Header Auth credential name 'CIM Internal Service Bearer'.
3. Dead-Letter Queue (DLQ) & Admin Recovery CLI:
   - Crash recovery (--recover) resets expired leases.
   - DLQ inspection (--list-failed, --list-notifications).
   - Mandatory audit reason (--reason) strictly enforced for admin retries.
   - 'uncertain' status invariant: never automatically resent.
4. Mock email dispatch & content safety guards:
   - Safe mock email sending and duplicate suppression (was_newly_sent=False).
   - Prohibited internal content rejected.
5. Periodic SLA check CLI integration (--check-sla).
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.models import Session as UserSession
from app.auth.seed_demo import DEMO_DEPARTMENTS
from app.automation.models import Notification, OutboxEvent
from app.automation.publisher import InMemoryEventPublisher, set_event_publisher
from app.automation.router import _IN_MEMORY_EVALUATIONS, _IN_MEMORY_NOTIFICATIONS_STORE
from app.automation.run_worker import main as worker_cli_main
from app.automation.schemas import EventType
from app.automation.service_auth import (
    DEFAULT_DEMO_SERVICE_TOKEN,
    clear_test_user_tokens,
    get_optional_db,
    token_manager,
)
from app.incidents.models import Incident
from app.main import app
from app.models import Department, User

TEST_SECRET = "w11-runbook-secret-99a1"
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
def client(session_factory, db_session):
    def override_get_optional_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_optional_db] = override_get_optional_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_optional_db, None)


# ===========================================================================
# 1. Runbook Documentation Completeness Tests
# ===========================================================================


def test_w11_runbook_documentation_completeness():
    """Verify docs/n5-runbook.md exists and covers all required W11 sections."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    runbook_path = repo_root / "docs" / "n5-runbook.md"
    readme_path = repo_root / "workflows" / "README.md"
    contract_path = repo_root / "docs" / "n5-event-contract.md"

    assert runbook_path.exists(), "docs/n5-runbook.md must exist"
    assert readme_path.exists(), "workflows/README.md must exist"
    assert contract_path.exists(), "docs/n5-event-contract.md must exist"

    runbook_content = runbook_path.read_text(encoding="utf-8")

    # 1. Clean setup & Docker
    assert "Dựng môi trường n8n hoàn toàn mới" in runbook_content
    assert "compose.yaml" in runbook_content or "docker compose" in runbook_content
    assert "5678" in runbook_content

    # 2. Credentials outside Git
    assert "CIM Internal Service Bearer" in runbook_content
    assert "CIM_INTERNAL_SERVICE_BEARER_TOKENS" in runbook_content
    assert "CIM_WEBHOOK_HMAC_SECRET" in runbook_content
    assert "MOCK_EMAIL_SENDING" in runbook_content

    # 3. 4 Workflows documented
    assert "health-check.json" in runbook_content
    assert "event-processor.json" in runbook_content
    assert "notification-processor.json" in runbook_content
    assert "sla-check.json" in runbook_content
    assert "CIMHealthCheck001" in runbook_content
    assert "CIMEventProcessor001" in runbook_content
    assert "CIMNotificationProcessor001" in runbook_content
    assert "CIMSlaScheduleCheck001" in runbook_content

    # 4. Dead-Letter Queue & Invariant
    assert "Dead-Letter Queue" in runbook_content or "hàng chờ lỗi" in runbook_content
    assert "--list-failed" in runbook_content
    assert "--list-notifications" in runbook_content
    assert "uncertain" in runbook_content
    assert "--reason" in runbook_content

    # 5. Recovery Procedures
    assert "--recover" in runbook_content
    assert "--retry-event" in runbook_content
    assert "--retry-notification" in runbook_content

    # 6. Test scenarios
    assert "send-signed-event.py" in runbook_content
    assert "--check-sla" in runbook_content

    # Cross references in README and event-contract
    readme_content = readme_path.read_text(encoding="utf-8")
    assert "n5-runbook.md" in readme_content

    contract_content = contract_path.read_text(encoding="utf-8")
    assert "n5-runbook.md" in contract_content


# ===========================================================================
# 2. Workflows JSON Validity and Integrity Tests
# ===========================================================================


def test_w11_all_four_workflows_json_validity_and_integrity():
    """Verify all 4 workflows have valid JSON, metadata, and credentials."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    workflows_dir = repo_root / "workflows"

    expected_workflows = {
        "health-check.json": {
            "id": "CIMHealthCheck001",
            "trigger_type": "n8n-nodes-base.manualTrigger",
            "requires_credential": False,
        },
        "event-processor.json": {
            "id": "CIMEventProcessor001",
            "trigger_type": "n8n-nodes-base.webhook",
            "requires_credential": True,
        },
        "notification-processor.json": {
            "id": "CIMNotificationProcessor001",
            "trigger_type": "n8n-nodes-base.webhook",
            "requires_credential": True,
        },
        "sla-check.json": {
            "id": "CIMSlaScheduleCheck001",
            "trigger_type": "n8n-nodes-base.scheduleTrigger",
            "requires_credential": True,
        },
    }

    for filename, meta in expected_workflows.items():
        file_path = workflows_dir / filename
        assert file_path.exists(), f"Workflow file {filename} must exist"

        data = json.loads(file_path.read_text(encoding="utf-8"))
        assert data.get("id") == meta["id"], f"Workflow {filename} must have id {meta['id']}"
        assert "nodes" in data and len(data["nodes"]) > 0, f"Workflow {filename} must have nodes"

        node_types = [n.get("type") for n in data["nodes"]]
        assert meta["trigger_type"] in node_types, (
            f"Workflow {filename} must contain trigger {meta['trigger_type']}"
        )

        if meta["requires_credential"]:
            # Check Header Auth credential 'CIM Internal Service Bearer'
            found_cred = False
            for node in data["nodes"]:
                creds = node.get("credentials", {})
                http_header_auth = creds.get("httpHeaderAuth", {})
                if (
                    http_header_auth.get("name") == "CIM Internal Service Bearer"
                    or http_header_auth.get("id") == "cim-internal-service-bearer"
                ):
                    found_cred = True
                    break
            assert found_cred, (
                f"Workflow {filename} must reference 'CIM Internal Service Bearer' credential"
            )


# ===========================================================================
# 3. Dead-Letter Queue & Recovery CLI Operations Tests
# ===========================================================================


def test_w11_worker_cli_crash_recovery(session_factory, monkeypatch):
    """Test worker CLI --recover cleans up expired processing leases back to pending."""
    monkeypatch.setattr("app.automation.run_worker.SessionLocal", session_factory)

    expired_time = datetime.now(UTC) - timedelta(minutes=5)
    event_id = uuid.uuid4()
    with session_factory() as session:
        ev = OutboxEvent(
            id=event_id,
            event_type=EventType.INCIDENT_REPORTED.value,
            incident_id=uuid.uuid4(),
            request_id=uuid.uuid4(),
            occurred_at=datetime.now(UTC),
            schema_version=1,
            status="processing",
            attempt_count=1,
            max_attempts=5,
            lease_token="dead-worker-pid-9999",
            lease_expires_at=expired_time,
        )
        session.add(ev)
        session.commit()

    # Execute CLI with --recover
    rc = worker_cli_main(["--recover"])
    assert rc == 0

    with session_factory() as session:
        updated = session.get(OutboxEvent, event_id)
        assert updated is not None
        assert updated.status == "pending"
        assert updated.lease_token is None
        assert updated.lease_expires_at is None


def test_w11_worker_cli_dead_letter_and_retry_event(session_factory, monkeypatch, capsys):
    """Test worker CLI --list-failed and --retry-event requiring mandatory --reason."""
    monkeypatch.setattr("app.automation.run_worker.SessionLocal", session_factory)

    failed_id = uuid.uuid4()
    with session_factory() as session:
        ev = OutboxEvent(
            id=failed_id,
            event_type=EventType.INCIDENT_REPORTED.value,
            incident_id=uuid.uuid4(),
            request_id=uuid.uuid4(),
            occurred_at=datetime.now(UTC),
            schema_version=1,
            status="failed",
            attempt_count=5,
            max_attempts=5,
            error_message="HTTP 500 n8n internal server error",
        )
        session.add(ev)
        session.commit()

    # 1. Test --list-failed
    rc = worker_cli_main(["--list-failed"])
    assert rc == 0
    out = capsys.readouterr().out
    assert str(failed_id) in out
    assert "dead-letter event(s)" in out

    # 2. Test --retry-event WITHOUT --reason (Must fail with rc=1)
    rc_no_reason = worker_cli_main(["--retry-event", str(failed_id)])
    assert rc_no_reason == 1
    err_out = capsys.readouterr().out
    assert "--reason is required" in err_out

    # 3. Test --retry-event WITH --reason (Must succeed with rc=0)
    audit_reason = "Admin confirmed n8n webhook service recovered"
    rc_success = worker_cli_main(["--retry-event", str(failed_id), "--reason", audit_reason])
    assert rc_success == 0

    with session_factory() as session:
        retried = session.get(OutboxEvent, failed_id)
        assert retried is not None
        assert retried.status == "pending"
        assert audit_reason in retried.error_message


def test_w11_worker_cli_notifications_inspection_and_retry(session_factory, monkeypatch, capsys):
    """Test worker CLI --list-notifications and --retry-notification with mandatory --reason."""
    monkeypatch.setattr("app.automation.run_worker.SessionLocal", session_factory)

    notif_id = uuid.uuid4()
    reporter_id = uuid.UUID("10000000-0000-4000-8000-000000000001")
    with session_factory() as session:
        notif = Notification(
            id=notif_id,
            event_id=uuid.uuid4(),
            kind="incident.reported",
            recipient_user_id=reporter_id,
            status="uncertain",
            error_message="Gateway Timeout 504",
        )
        session.add(notif)
        session.commit()

    # 1. Test --list-notifications with status filter
    rc = worker_cli_main(["--list-notifications", "--status", "uncertain"])
    assert rc == 0
    out = capsys.readouterr().out
    assert str(notif_id) in out
    assert "uncertain" in out

    # 2. Test --retry-notification WITHOUT --reason (Must fail with rc=1)
    rc_fail = worker_cli_main(["--retry-notification", str(notif_id)])
    assert rc_fail == 1
    err_out = capsys.readouterr().out
    assert "--reason is required" in err_out

    # 3. Test --retry-notification WITH --reason (Must succeed with rc=0)
    audit_reason = "Spoke with user, verified email was never delivered"
    rc_ok = worker_cli_main(["--retry-notification", str(notif_id), "--reason", audit_reason])
    assert rc_ok == 0

    with session_factory() as session:
        updated_n = session.get(Notification, notif_id)
        assert updated_n is not None
        assert updated_n.status == "pending"
        assert audit_reason in (updated_n.error_message or "")


def test_w11_worker_cli_check_sla(session_factory, monkeypatch, capsys):
    """Test worker CLI --check-sla triggers SLA escalation review."""
    monkeypatch.setattr("app.automation.run_worker.SessionLocal", session_factory)

    rc = worker_cli_main(["--check-sla"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "SLA check completed" in out


# ===========================================================================
# 4. Mock Email Dispatch, Anti-Duplication & Content Safety
# ===========================================================================


def test_w11_mock_email_dispatch_and_duplicate_suppression(client):
    """Test safe mock email dispatch, provider message ID, and duplicate suppression."""
    event_id = str(uuid.uuid4())
    recipient_user_id = "10000000-0000-4000-8000-000000000001"
    incident_id = str(uuid.uuid4())

    payload = {
        "event_id": event_id,
        "scenario": "reported",
        "recipient_user_id": recipient_user_id,
        "recipient_email": "reporter@demo.invalid",
        "incident_id": incident_id,
        "category": "incident.reported",
    }

    # 1. First dispatch -> sent
    resp1 = client.post("/internal/notifications/dispatch", json=payload, headers=SERVICE_HEADERS)
    assert resp1.status_code == 200, resp1.text
    data1 = resp1.json()
    assert data1["status"] == "sent"
    assert data1["was_newly_sent"] is True
    assert data1["provider_message_id"] is not None

    # 2. Duplicate dispatch -> skipped (was_newly_sent=False)
    resp2 = client.post("/internal/notifications/dispatch", json=payload, headers=SERVICE_HEADERS)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["notification_id"] == data1["notification_id"]
    assert data2["was_newly_sent"] is False


def test_w11_content_safety_guard_rejects_internal_data(client):
    """Test safety guard prevents leaking internal notes or staff links in reporter email."""
    event_id = str(uuid.uuid4())
    payload = {
        "event_id": event_id,
        "scenario": "public_state_updated",
        "recipient_user_id": "10000000-0000-4000-8000-000000000001",
        "recipient_email": "reporter@demo.invalid",
        "incident_id": str(uuid.uuid4()),
        "new_state": "in_progress",
        "resolution_summary": "Handling staff note: [internal] confidential triage details",
    }

    resp = client.post("/internal/notifications/dispatch", json=payload, headers=SERVICE_HEADERS)
    assert resp.status_code == 422
    assert "Prohibited internal note" in resp.json()["detail"]
