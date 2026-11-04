import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles, deregister
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import main
from app.auth.dependencies import get_db
from app.auth.policy import Principal, get_principal
from app.automation.models import OutboxEvent
from app.automation.publisher import OutboxEventPublisher
from app.comments.logic import require_incident_access
from app.incidents.models import Incident
from app.models import Department, User
from app.workflow.contracts import AssignRequest, WorkflowViolation
from app.workflow.models import Assignment, AuditLog, StatusHistory
from app.workflow.service import AssignmentService


@pytest.fixture
def case():
    compiles(JSONB, "sqlite")(lambda element, compiler, **kw: "JSON")
    engine = sa.create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.connection.driver_connection.create_function(
            "jsonb_typeof",
            1,
            lambda value: "object" if isinstance(json.loads(value), dict) else "array",
        )
        User.metadata.create_all(
            connection,
            tables=[
                Department.__table__,
                User.__table__,
                Incident.__table__,
                Assignment.__table__,
                StatusHistory.__table__,
                AuditLog.__table__,
                OutboxEvent.__table__,
            ],
        )
        connection.commit()
        with Session(connection, expire_on_commit=False) as session:
            current, target, triage = uuid4(), uuid4(), uuid4()
            session.add_all(
                [
                    Department(id=current, name="Source"),
                    Department(id=target, name="Target"),
                    Department(id=triage, name="triage_queue"),
                ]
            )
            session.flush()
            users = {}
            for name, role, department, active in [
                ("reporter", "reporter", None, True),
                ("handler", "handler", current, True),
                ("target_handler", "handler", target, True),
                ("inactive", "handler", target, False),
                ("manager", "department_manager", current, True),
                ("other_manager", "department_manager", target, True),
                ("admin", "administrator", None, True),
            ]:
                uid = uuid4()
                session.add(
                    User(
                        id=uid,
                        email=f"{uid}@example.com",
                        display_name=name,
                        password_hash="test-only",
                        role=role,
                        department_id=department,
                        is_active=active,
                    )
                )
                users[name] = Principal(str(uid), role, str(department) if department else None)
            session.flush()
            incident = Incident(
                id=uuid4(),
                reporter_id=UUID(users["reporter"].user_id),
                category="water_leak",
                title="Water leak",
                description="Water leaking near classroom door",
                building="A",
                answers={},
                department_id=current,
                assigned_handler_id=UUID(users["handler"].user_id),
                status="reported",
                version=1,
                priority="p1",
                acknowledgment_deadline_at=datetime.now(UTC) + timedelta(minutes=15),
            )
            session.add(incident)
            session.commit()
            connection.exec_driver_sql("BEGIN")
            yield SimpleNamespace(
                session=session,
                incident=incident,
                users=users,
                current=current,
                target=target,
                triage=triage,
                principal=users["manager"],
            )
            session.rollback()
    engine.dispose()
    deregister(JSONB)


def request(case, **changes):
    data = dict(
        department_id=case.target,
        handler_id=UUID(case.users["target_handler"].user_id),
        reason="Transfer to responsible department",
        expected_version=1,
    )
    data.update(changes)
    return AssignRequest(**data)


def assign(case, payload=None, principal=None):
    return AssignmentService(case.session).assign(
        principal or case.users["manager"],
        case.incident.id,
        payload or request(case),
        request_id=uuid4(),
    )


def counts(case):
    return [
        case.session.scalar(sa.select(sa.func.count()).select_from(model))
        for model in (Assignment, StatusHistory, AuditLog, OutboxEvent)
    ]


def test_first_assignment_persists_full_transaction(case):
    original_deadline = case.incident.acknowledgment_deadline_at
    result = assign(case)
    assert result.incident.status == "assigned" and result.incident.version == 2
    assert result.incident.department_id == case.target
    assert result.incident.assigned_handler_id == UUID(case.users["target_handler"].user_id)
    assert result.incident.acknowledged_at is None
    assert counts(case) == [1, 1, 1, 1]
    assert case.session.get(Assignment, result.history_id).reason == request(case).reason
    event = case.session.scalar(sa.select(OutboxEvent))
    assert event.event_type == "incident.assigned" and event.status == "pending"
    assert "reason" not in event.payload and "description" not in event.payload
    assert result.incident.acknowledgment_deadline_at.replace(tzinfo=UTC) == (
        original_deadline.replace(tzinfo=UTC)
    )


@pytest.mark.parametrize("status", ["assigned", "in_progress"])
def test_reassignment_preserves_state_and_sla(case, status):
    original = datetime(2026, 11, 2, 1, tzinfo=UTC)
    case.incident.status = status
    case.incident.assigned_at = original
    case.incident.acknowledged_at = original
    case.session.flush()
    result = assign(case)
    assert result.incident.status == status
    assert result.incident.assigned_at.replace(tzinfo=UTC) == original
    assert result.incident.acknowledged_at.replace(tzinfo=UTC) == original
    assert counts(case) == [1, 0, 1, 1]  # Assignment is history; no fake status change.
    with pytest.raises(WorkflowViolation):
        require_incident_access(case.users["handler"], case.incident)


def test_manager_can_assign_department_without_handler(case):
    assert assign(case, request(case, handler_id=None)).incident.assigned_handler_id is None


def test_admin_can_assign_unclassified_incident(case):
    case.incident.department_id = None
    case.incident.assigned_handler_id = None
    case.session.flush()
    assert assign(case, principal=case.users["admin"]).incident.status == "assigned"


def test_triage_transfer_clears_review_flag_without_inventing_priority(case):
    case.incident.department_id = case.triage
    case.incident.triage_required = True
    case.incident.priority = None
    case.session.flush()
    result = assign(
        case,
        principal=Principal(case.users["manager"].user_id, "department_manager", str(case.triage)),
    )
    assert not result.incident.triage_required and result.incident.priority is None


@pytest.mark.parametrize("role,code", [("reporter", 403), ("handler", 403), ("other_manager", 404)])
def test_unauthorized_assignment_writes_nothing(case, role, code):
    with pytest.raises(WorkflowViolation) as error:
        assign(case, principal=case.users[role])
    assert error.value.http_status == code
    assert counts(case) == [0, 0, 0, 0] and case.incident.version == 1


@pytest.mark.parametrize(
    "kind",
    [
        "missing_department",
        "triage_target",
        "missing_handler",
        "wrong_department",
        "wrong_role",
        "inactive",
    ],
)
def test_invalid_target_writes_nothing(case, kind):
    changes = {
        "missing_department": {"department_id": uuid4()},
        "triage_target": {"department_id": case.triage, "handler_id": None},
        "missing_handler": {"handler_id": uuid4()},
        "wrong_department": {"handler_id": UUID(case.users["handler"].user_id)},
        "wrong_role": {"handler_id": UUID(case.users["other_manager"].user_id)},
        "inactive": {"handler_id": UUID(case.users["inactive"].user_id)},
    }
    with pytest.raises(WorkflowViolation) as error:
        assign(case, request(case, **changes[kind]))
    assert (error.value.code, error.value.http_status) == ("validation_error", 422)
    assert counts(case) == [0, 0, 0, 0]


@pytest.mark.parametrize("status", ["resolved", "closed"])
def test_terminal_status_cannot_be_reassigned(case, status):
    case.incident.status = status
    case.session.flush()
    with pytest.raises(WorkflowViolation) as error:
        assign(case)
    assert error.value.code == "invalid_transition" and counts(case) == [0, 0, 0, 0]


def test_repeated_expected_version_is_rejected(case):
    assign(case)
    with pytest.raises(WorkflowViolation) as error:
        assign(case, principal=case.users["admin"])
    assert error.value.code == "version_conflict" and counts(case) == [1, 1, 1, 1]


def test_outbox_failure_rolls_back_everything(case, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("Simulated outbox failure")

    monkeypatch.setattr(OutboxEventPublisher, "create_and_publish", fail)
    with pytest.raises(RuntimeError):
        assign(case)
    case.session.refresh(case.incident)
    assert case.incident.version == 1 and case.incident.department_id == case.current
    assert counts(case) == [0, 0, 0, 0]


def test_caller_rollback_undoes_assignment(case):
    incident_id = case.incident.id
    assign(case)
    case.session.rollback()
    assert case.session.get(Incident, incident_id).version == 1
    assert counts(case) == [0, 0, 0, 0]


@pytest.fixture
def assignment_client(case):
    def db():
        yield case.session

    main.app.dependency_overrides[get_db] = db
    main.app.dependency_overrides[get_principal] = lambda: case.principal
    try:
        with TestClient(main.app) as client:
            yield client
    finally:
        main.app.dependency_overrides.pop(get_db, None)
        main.app.dependency_overrides.pop(get_principal, None)


def test_assign_endpoint_commits_and_returns_contract(case, assignment_client):
    correlation = str(uuid4())
    response = assignment_client.post(
        f"/api/v1/incidents/{case.incident.id}/assign",
        json=request(case).model_dump(mode="json"),
        headers={"X-Request-ID": correlation},
    )
    assert response.status_code == 200
    assert set(response.json()) == {"incident", "history_id"}
    assert response.json()["incident"]["status"] == "assigned"
    assert response.json()["incident"]["reported_at"].endswith("Z")
    assert response.headers["X-Request-ID"] == correlation


@pytest.mark.parametrize(
    "changes",
    [
        {"reason": "  "},
        {"expected_version": 0},
        {"expected_version": True},
        {"actor_id": "fake"},
        {"handler_id": "bad-id"},
    ],
)
def test_assign_endpoint_rejects_invalid_input(case, assignment_client, changes):
    payload = request(case).model_dump(mode="json")
    payload.update(changes)
    response = assignment_client.post(f"/api/v1/incidents/{case.incident.id}/assign", json=payload)
    assert response.status_code == 422 and response.json()["error"]["code"] == "validation_error"
    assert counts(case) == [0, 0, 0, 0]


@pytest.mark.parametrize("role,expected", [("reporter", 403), ("other_manager", 404)])
def test_assign_endpoint_hides_out_of_scope(case, assignment_client, role, expected):
    case.principal = case.users[role]
    response = assignment_client.post(
        f"/api/v1/incidents/{case.incident.id}/assign", json=request(case).model_dump(mode="json")
    )
    assert response.status_code == expected
    assert response.headers["X-Request-ID"] == response.json()["error"]["request_id"]


def test_missing_incident_has_same_not_found_response(case, assignment_client):
    response = assignment_client.post(
        f"/api/v1/incidents/{uuid4()}/assign", json=request(case).model_dump(mode="json")
    )
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


def test_assign_endpoint_requires_login(case, assignment_client):
    main.app.dependency_overrides.pop(get_principal)
    response = assignment_client.post(
        f"/api/v1/incidents/{case.incident.id}/assign", json=request(case).model_dump(mode="json")
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_actual_seed_triage_name_is_not_a_processing_department(case):
    from app.rules.engine import MANUAL_QUEUE

    case.session.get(Department, case.triage).name = MANUAL_QUEUE
    case.session.flush()
    with pytest.raises(WorkflowViolation) as error:
        assign(case, request(case, department_id=case.triage, handler_id=None))
    assert error.value.code == "validation_error" and counts(case) == [0, 0, 0, 0]


def test_sql_version_guard_catches_update_between_read_and_write(case, monkeypatch):
    original = case.session.execute
    injected = False

    def competing_update(statement, *args, **kwargs):
        nonlocal injected
        if isinstance(statement, sa.sql.dml.Update) and not injected:
            injected = True
            original(
                sa.update(Incident)
                .where(Incident.id == case.incident.id)
                .values(version=2)
                .execution_options(synchronize_session=False)
            )
        return original(statement, *args, **kwargs)

    monkeypatch.setattr(case.session, "execute", competing_update)
    with pytest.raises(WorkflowViolation) as error:
        assign(case)
    assert injected and error.value.code == "version_conflict"
    assert counts(case) == [0, 0, 0, 0]


def test_commit_failure_returns_safe_error_and_rolls_back(case, assignment_client, monkeypatch):
    from sqlalchemy.exc import OperationalError

    def fail():
        raise OperationalError("commit", {}, Exception("private-credential"))

    monkeypatch.setattr(case.session, "commit", fail)
    response = assignment_client.post(
        f"/api/v1/incidents/{case.incident.id}/assign", json=request(case).model_dump(mode="json")
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"
    assert "private-credential" not in response.text
    assert counts(case) == [0, 0, 0, 0]


def test_invalid_correlation_id_is_replaced(case, assignment_client):
    response = assignment_client.post(
        f"/api/v1/incidents/{uuid4()}/assign",
        json=request(case).model_dump(mode="json"),
        headers={"X-Request-ID": "not-a-uuid"},
    )
    assert response.status_code == 404
    assert str(UUID(response.headers["X-Request-ID"])) == response.json()["error"]["request_id"]


def test_workflow_cors_allows_correlation_header(assignment_client):
    response = assignment_client.options(
        "/api/v1/incidents/any/assign",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization, Content-Type, X-Request-ID",
        },
    )
    assert response.status_code == 200
    assert "x-request-id" in response.headers["access-control-allow-headers"].lower()
