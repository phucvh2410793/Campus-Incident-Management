from datetime import UTC, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import OperationalError

# Reuse the isolated W4 database and HTTP fixtures instead of duplicating seeds.
from test_assignment import assignment_client as assignment_client
from test_assignment import case as case

from app import main
from app.auth.policy import get_principal
from app.incidents.models import Incident
from app.sla.policy import should_escalate
from app.workflow.contracts import AcknowledgeRequest, WorkflowViolation
from app.workflow.models import AuditLog, StatusHistory
from app.workflow.repository import WorkflowRepository
from app.workflow.service import AcknowledgmentService

NOW = datetime(2026, 11, 9, 2, 10, tzinfo=UTC)


@pytest.fixture
def assigned(case):
    case.incident.status = "assigned"
    case.incident.reported_at = NOW - timedelta(minutes=10)
    case.incident.assigned_at = NOW - timedelta(minutes=5)
    case.incident.acknowledgment_deadline_at = NOW + timedelta(minutes=5)
    case.session.flush()
    return case


def acknowledge(case, *, role="handler", version=1, clock=lambda: NOW):
    return AcknowledgmentService(case.session, clock=clock).acknowledge(
        case.users[role],
        case.incident.id,
        AcknowledgeRequest(expected_version=version),
        request_id=uuid4(),
    )


def records(case):
    return [
        case.session.scalar(sa.select(sa.func.count()).select_from(model))
        for model in (StatusHistory, AuditLog)
    ]


@pytest.mark.parametrize("role", ["handler", "manager", "admin"])
def test_authorized_acknowledgment_persists_one_transition(assigned, role):
    case = assigned
    result = acknowledge(case, role=role)
    assert result.incident.status == "in_progress" and result.incident.version == 2
    assert result.incident.acknowledged_at.replace(tzinfo=UTC) == NOW
    assert result.incident.assigned_at.replace(tzinfo=UTC) == NOW - timedelta(minutes=5)
    assert result.incident.acknowledgment_deadline_at.replace(tzinfo=UTC) == (
        NOW + timedelta(minutes=5)
    )
    history = case.session.get(StatusHistory, result.history_id)
    assert (history.from_status, history.to_status, history.visibility) == (
        "assigned",
        "in_progress",
        "public",
    )
    assert str(history.actor_id) == case.users[role].user_id
    audit = case.session.scalar(sa.select(AuditLog))
    assert audit.action == "incident.acknowledged"
    assert audit.before["status"] == "assigned" and audit.after["version"] == 2
    assert records(case) == [1, 1]


@pytest.mark.parametrize(
    "role,expected", [("reporter", 403), ("target_handler", 404), ("other_manager", 404)]
)
def test_unauthorized_caller_cannot_acknowledge(assigned, role, expected):
    with pytest.raises(WorkflowViolation) as error:
        acknowledge(assigned, role=role)
    assert error.value.http_status == expected
    assert assigned.incident.acknowledged_at is None and records(assigned) == [0, 0]


@pytest.mark.parametrize("status", ["reported", "in_progress", "resolved", "closed"])
def test_only_assigned_state_can_be_acknowledged(assigned, status):
    assigned.incident.status = status
    assigned.session.flush()
    with pytest.raises(WorkflowViolation) as error:
        acknowledge(assigned, role="admin")
    assert error.value.code == "invalid_transition" and records(assigned) == [0, 0]


@pytest.mark.parametrize("version", [1, 2])
def test_repeated_acknowledgment_never_changes_timestamp(assigned, version):
    acknowledge(assigned)
    with pytest.raises(WorkflowViolation) as error:
        acknowledge(assigned, version=version, clock=lambda: NOW + timedelta(hours=1))
    assert error.value.code == ("version_conflict" if version == 1 else "invalid_transition")
    assigned.session.refresh(assigned.incident)
    assert assigned.incident.acknowledged_at.replace(tzinfo=UTC) == NOW
    assert assigned.incident.version == 2 and records(assigned) == [1, 1]


def test_existing_timestamp_is_preserved_even_if_state_is_assigned(assigned):
    original = NOW - timedelta(minutes=1)
    assigned.incident.acknowledged_at = original
    assigned.session.flush()
    assert acknowledge(assigned).incident.acknowledged_at.replace(tzinfo=UTC) == original


@pytest.mark.parametrize("version", [2, 3])
def test_stale_or_future_version_has_no_side_effects(assigned, version):
    with pytest.raises(WorkflowViolation) as error:
        acknowledge(assigned, version=version)
    assert error.value.code == "version_conflict"
    assert assigned.incident.version == 1 and records(assigned) == [0, 0]


def test_old_handler_loses_permission_after_reassignment(assigned):
    assigned.incident.assigned_handler_id = UUID(assigned.users["target_handler"].user_id)
    assigned.session.flush()
    with pytest.raises(WorkflowViolation) as error:
        acknowledge(assigned)
    assert error.value.http_status == 404 and records(assigned) == [0, 0]


def test_handler_who_reported_but_is_not_assigned_cannot_acknowledge(assigned):
    assigned.incident.reporter_id = UUID(assigned.users["handler"].user_id)
    assigned.incident.assigned_handler_id = UUID(assigned.users["target_handler"].user_id)
    assigned.session.flush()

    with pytest.raises(WorkflowViolation):
        acknowledge(assigned)

    assert assigned.incident.version == 1
    assert assigned.incident.acknowledged_at is None and records(assigned) == [0, 0]


def test_manager_who_reported_outside_their_department_cannot_acknowledge(assigned):
    assigned.incident.reporter_id = UUID(assigned.users["other_manager"].user_id)
    assigned.session.flush()

    with pytest.raises(WorkflowViolation):
        acknowledge(assigned, role="other_manager")

    assert assigned.incident.version == 1
    assert assigned.incident.acknowledged_at is None and records(assigned) == [0, 0]


def test_manager_can_receive_department_assignment_without_handler(assigned):
    assigned.incident.assigned_handler_id = None
    assigned.session.flush()
    assert acknowledge(assigned, role="manager").incident.status == "in_progress"


def test_acknowledgment_stops_sla_without_resetting_deadline(assigned):
    incident = acknowledge(assigned).incident
    assert not should_escalate(
        incident.reported_at.replace(tzinfo=UTC),
        incident.priority,
        NOW + timedelta(hours=1),
        acknowledged_at=incident.acknowledged_at.replace(tzinfo=UTC),
    )
    assert incident.acknowledgment_deadline_at.replace(tzinfo=UTC) == NOW + timedelta(minutes=5)


def test_clock_is_converted_to_utc(assigned):
    local_time = NOW.astimezone(timezone(timedelta(hours=7)))
    result = acknowledge(assigned, clock=lambda: local_time)
    assert result.incident.acknowledged_at.replace(tzinfo=UTC) == NOW


def test_naive_clock_is_rejected_before_writing(assigned):
    with pytest.raises(ValueError):
        acknowledge(assigned, clock=lambda: NOW.replace(tzinfo=None))
    assert assigned.incident.version == 1 and records(assigned) == [0, 0]


def test_audit_failure_rolls_back_timestamp_state_and_history(assigned, monkeypatch):
    def fail(*args):
        raise RuntimeError("Simulated audit failure")

    monkeypatch.setattr(WorkflowRepository, "add_audit", fail)
    with pytest.raises(RuntimeError):
        acknowledge(assigned)
    assigned.session.refresh(assigned.incident)
    assert assigned.incident.status == "assigned" and assigned.incident.version == 1
    assert assigned.incident.acknowledged_at is None and records(assigned) == [0, 0]


def test_caller_can_roll_back_acknowledgment(assigned):
    # Persist the fixture's assigned state outside the command's transaction.
    assigned.session.flush()
    result = acknowledge(assigned)
    assert result.incident.version == 2
    assigned.session.rollback()
    assigned.session.refresh(assigned.incident)
    # The W4 fixture's original state is reported; all local changes roll back.
    assert assigned.incident.status == "reported" and assigned.incident.version == 1
    assert assigned.incident.acknowledged_at is None and records(assigned) == [0, 0]


def test_competing_update_is_rejected_by_database_condition(assigned, monkeypatch):
    original = assigned.session.execute
    injected = False

    def competing_update(statement, *args, **kwargs):
        nonlocal injected
        if isinstance(statement, sa.sql.dml.Update) and not injected:
            injected = True
            original(
                sa.update(Incident)
                .where(Incident.id == assigned.incident.id)
                .values(version=2)
                .execution_options(synchronize_session=False)
            )
        return original(statement, *args, **kwargs)

    monkeypatch.setattr(assigned.session, "execute", competing_update)
    with pytest.raises(WorkflowViolation) as error:
        acknowledge(assigned)
    assert injected and error.value.code == "version_conflict" and records(assigned) == [0, 0]


def test_acknowledge_endpoint_returns_history_and_correlation(assigned, assignment_client):
    assigned.principal = assigned.users["handler"]
    correlation = str(uuid4())
    response = assignment_client.post(
        f"/api/v1/incidents/{assigned.incident.id}/acknowledge",
        json={"expected_version": 1},
        headers={"X-Request-ID": correlation},
    )
    assert response.status_code == 200
    assert set(response.json()) == {"incident", "history_id"}
    assert response.json()["incident"]["status"] == "in_progress"
    assert response.json()["incident"]["acknowledged_at"].endswith("Z")
    assert response.headers["X-Request-ID"] == correlation


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"expected_version": 0},
        {"expected_version": True},
        {"expected_version": "1"},
        {"expected_version": 1, "actor_id": "fake"},
        {"expected_version": 1, "acknowledged_at": "2026-01-01T00:00:00Z"},
    ],
)
def test_endpoint_rejects_bad_version_and_client_timestamps(assigned, assignment_client, payload):
    response = assignment_client.post(
        f"/api/v1/incidents/{assigned.incident.id}/acknowledge", json=payload
    )
    assert response.status_code == 422 and response.json()["error"]["code"] == "validation_error"
    assert records(assigned) == [0, 0]


def test_missing_incident_returns_404(assigned, assignment_client):
    response = assignment_client.post(
        f"/api/v1/incidents/{uuid4()}/acknowledge", json={"expected_version": 1}
    )
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


def test_endpoint_requires_authentication(assigned, assignment_client):
    main.app.dependency_overrides.pop(get_principal)
    response = assignment_client.post(
        f"/api/v1/incidents/{assigned.incident.id}/acknowledge", json={"expected_version": 1}
    )
    assert response.status_code == 401 and response.json()["error"]["code"] == "unauthenticated"


def test_endpoint_commit_failure_rolls_back(assigned, assignment_client, monkeypatch):
    def fail():
        raise OperationalError("commit", {}, Exception("private-credential"))

    monkeypatch.setattr(assigned.session, "commit", fail)
    response = assignment_client.post(
        f"/api/v1/incidents/{assigned.incident.id}/acknowledge", json={"expected_version": 1}
    )
    assert response.status_code == 503 and "private-credential" not in response.text
    assert records(assigned) == [0, 0]


@pytest.mark.parametrize(
    "role,status", [("reporter", 403), ("other_manager", 404), ("target_handler", 404)]
)
def test_endpoint_enforces_record_scope(assigned, assignment_client, role, status):
    assigned.principal = assigned.users[role]
    response = assignment_client.post(
        f"/api/v1/incidents/{assigned.incident.id}/acknowledge", json={"expected_version": 1}
    )
    assert response.status_code == status and records(assigned) == [0, 0]
