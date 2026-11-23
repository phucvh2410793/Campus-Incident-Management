from datetime import UTC, datetime, timedelta
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
from app.workflow.contracts import DispositionRequest, TransitionRequest, WorkflowViolation
from app.workflow.models import AuditLog, StatusHistory
from app.workflow.repository import WorkflowRepository
from app.workflow.service import DispositionService, TransitionService

NOW = datetime(2026, 11, 21, 6, 30, tzinfo=UTC)


@pytest.fixture
def in_progress(case):
    case.incident.status = "in_progress"
    case.incident.acknowledged_at = NOW - timedelta(minutes=5)
    case.session.flush()
    return case


@pytest.fixture
def resolved(in_progress):
    in_progress.incident.status = "resolved"
    in_progress.incident.resolved_at = NOW
    in_progress.session.flush()
    return in_progress


@pytest.fixture
def closed(resolved):
    resolved.incident.status = "closed"
    resolved.incident.closed_at = NOW + timedelta(minutes=5)
    resolved.session.flush()
    return resolved


def transition(case, *, role="handler", target="resolved", version=1, resolution=None, reason=None):
    return TransitionService(case.session).transition(
        case.users[role],
        case.incident.id,
        TransitionRequest(
            target_status=target,
            expected_version=version,
            resolution=resolution,
            reason=reason,
        ),
        request_id=uuid4(),
    )


def disposition(
    case,
    *,
    role="manager",
    kind="duplicate",
    reason="Duplicate report",
    duplicate_of_id=None,
    version=1,
):
    return DispositionService(case.session).disposition(
        case.users[role],
        case.incident.id,
        DispositionRequest(
            kind=kind,
            reason=reason,
            duplicate_of_id=duplicate_of_id,
            expected_version=version,
        ),
        request_id=uuid4(),
    )


def records(case):
    return [
        case.session.scalar(sa.select(sa.func.count()).select_from(model))
        for model in (StatusHistory, AuditLog)
    ]


def other_incident(case):
    other = Incident(
        id=uuid4(),
        reporter_id=UUID(case.users["reporter"].user_id),
        category="water_leak",
        title="Other leak",
        description="Another leak in the same building",
        building="A",
        answers={},
        department_id=case.current,
        status="reported",
        version=1,
        priority="p2",
        acknowledgment_deadline_at=NOW + timedelta(minutes=15),
    )
    case.session.add(other)
    case.session.flush()
    return other


def test_handler_can_resolve_with_resolution(in_progress):
    result = transition(in_progress, resolution="Replaced the leaking pipe")
    assert result.incident.status == "resolved" and result.incident.version == 2
    assert result.incident.resolved_at is not None
    assert result.incident.closed_at is None
    history = in_progress.session.get(StatusHistory, result.history_id)
    assert (history.from_status, history.to_status, history.visibility) == (
        "in_progress",
        "resolved",
        "public",
    )
    assert history.resolution == "Replaced the leaking pipe"
    assert str(history.actor_id) == in_progress.users["handler"].user_id
    audit = in_progress.session.scalar(sa.select(AuditLog))
    assert audit.action == "incident.transition"
    assert audit.before["status"] == "in_progress" and audit.after["version"] == 2
    assert records(in_progress) == [1, 1]


def test_resolve_without_resolution_is_rejected(in_progress):
    with pytest.raises(WorkflowViolation) as error:
        transition(in_progress)
    assert error.value.code == "validation_error" and error.value.http_status == 422
    assert in_progress.incident.version == 1 and records(in_progress) == [0, 0]


def test_manager_can_close_resolved_without_reason(resolved):
    result = transition(resolved, role="manager", target="closed")
    assert result.incident.status == "closed" and result.incident.version == 2
    assert result.incident.closed_at is not None
    assert result.incident.resolved_at is not None
    history = resolved.session.get(StatusHistory, result.history_id)
    assert (history.from_status, history.to_status) == ("resolved", "closed")
    audit = resolved.session.scalar(sa.select(AuditLog))
    assert audit.action == "incident.transition"
    assert records(resolved) == [1, 1]


def test_handler_cannot_close_resolved(resolved):
    with pytest.raises(WorkflowViolation) as error:
        transition(resolved, role="handler", target="closed", reason="Done")
    assert error.value.code == "forbidden" and error.value.http_status == 403
    assert resolved.incident.version == 1 and records(resolved) == [0, 0]


def test_manager_can_return_resolved_to_in_progress(resolved):
    result = transition(resolved, role="manager", target="in_progress", reason="Fix did not hold")
    assert result.incident.status == "in_progress" and result.incident.version == 2
    assert result.incident.resolved_at is not None
    history = resolved.session.get(StatusHistory, result.history_id)
    assert (history.from_status, history.to_status) == ("resolved", "in_progress")
    assert history.reason == "Fix did not hold"
    assert records(resolved) == [1, 1]


def test_return_without_reason_is_rejected(resolved):
    with pytest.raises(WorkflowViolation) as error:
        transition(resolved, role="manager", target="in_progress")
    assert error.value.code == "validation_error" and error.value.http_status == 422
    assert resolved.incident.version == 1 and records(resolved) == [0, 0]


def test_manager_can_reopen_closed(closed):
    result = transition(
        closed, role="manager", target="in_progress", reason="Reporter confirmed the leak is back"
    )
    assert result.incident.status == "in_progress" and result.incident.version == 2
    assert result.incident.resolved_at is not None
    assert result.incident.closed_at is not None
    assert result.incident.acknowledged_at is not None
    history = closed.session.get(StatusHistory, result.history_id)
    assert (history.from_status, history.to_status) == ("closed", "in_progress")
    assert records(closed) == [1, 1]


def test_reopen_without_reason_is_rejected(closed):
    with pytest.raises(WorkflowViolation) as error:
        transition(closed, role="manager", target="in_progress")
    assert error.value.code == "validation_error" and error.value.http_status == 422
    assert closed.incident.version == 1 and records(closed) == [0, 0]


@pytest.mark.parametrize(
    "status,target",
    [
        ("reported", "resolved"),
        ("reported", "closed"),
        ("assigned", "resolved"),
        ("in_progress", "closed"),
        ("closed", "resolved"),
    ],
)
def test_unlisted_transition_is_rejected(case, status, target):
    case.incident.status = status
    case.session.flush()
    with pytest.raises(WorkflowViolation) as error:
        transition(case, role="admin", target=target, resolution="x", reason="x")
    assert error.value.code == "invalid_transition" and error.value.http_status == 409
    assert records(case) == [0, 0]


@pytest.mark.parametrize("version", [2, 3])
def test_stale_or_future_version_has_no_side_effects(in_progress, version):
    with pytest.raises(WorkflowViolation) as error:
        transition(in_progress, version=version, resolution="x")
    assert error.value.code == "version_conflict"
    assert in_progress.incident.version == 1 and records(in_progress) == [0, 0]


@pytest.mark.parametrize(
    "role,expected", [("reporter", 403), ("target_handler", 404), ("other_manager", 404)]
)
def test_unauthorized_caller_cannot_transition(in_progress, role, expected):
    with pytest.raises(WorkflowViolation) as error:
        transition(in_progress, role=role, resolution="x")
    assert error.value.http_status == expected
    assert records(in_progress) == [0, 0]


def test_audit_failure_rolls_back_transition(in_progress, monkeypatch):
    def fail(*args):
        raise RuntimeError("Simulated audit failure")

    monkeypatch.setattr(WorkflowRepository, "add_audit", fail)
    with pytest.raises(RuntimeError):
        transition(in_progress, resolution="x")
    in_progress.session.refresh(in_progress.incident)
    assert in_progress.incident.status == "in_progress" and in_progress.incident.version == 1
    assert in_progress.incident.resolved_at is None and records(in_progress) == [0, 0]


def test_disposition_duplicate_closes_incident(in_progress):
    original = other_incident(in_progress)
    result = disposition(
        in_progress,
        kind="duplicate",
        reason="Same leak reported twice",
        duplicate_of_id=original.id,
    )
    assert result.incident.status == "closed" and result.incident.version == 2
    assert result.incident.closed_at is not None
    history = in_progress.session.get(StatusHistory, result.history_id)
    assert (history.from_status, history.to_status) == ("in_progress", "closed")
    assert history.reason == "Same leak reported twice"
    audit = in_progress.session.scalar(sa.select(AuditLog))
    assert audit.action == "incident.disposition"
    assert audit.after["disposition"] == "duplicate"
    assert audit.after["duplicate_of_id"] == str(original.id)
    assert records(in_progress) == [1, 1]


def test_disposition_invalid_closes_incident(in_progress):
    result = disposition(in_progress, kind="invalid", reason="Not a real incident")
    assert result.incident.status == "closed" and result.incident.version == 2
    audit = in_progress.session.scalar(sa.select(AuditLog))
    assert audit.action == "incident.disposition"
    assert audit.after["disposition"] == "invalid"
    assert audit.after["duplicate_of_id"] is None
    assert records(in_progress) == [1, 1]


def test_handler_cannot_dispose(in_progress):
    with pytest.raises(WorkflowViolation) as error:
        disposition(in_progress, role="handler", kind="invalid", reason="x")
    assert error.value.code == "forbidden" and error.value.http_status == 403
    assert in_progress.incident.version == 1 and records(in_progress) == [0, 0]


def test_disposition_on_closed_is_rejected(closed):
    with pytest.raises(WorkflowViolation) as error:
        disposition(closed, kind="invalid", reason="x")
    assert error.value.code == "invalid_transition" and records(closed) == [0, 0]


def test_disposition_duplicate_requires_existing_target(in_progress):
    with pytest.raises(WorkflowViolation) as error:
        disposition(in_progress, kind="duplicate", reason="x", duplicate_of_id=uuid4())
    assert error.value.code == "validation_error" and error.value.http_status == 422
    assert records(in_progress) == [0, 0]


def test_disposition_duplicate_cannot_point_to_itself(in_progress):
    with pytest.raises(WorkflowViolation) as error:
        disposition(
            in_progress, kind="duplicate", reason="x", duplicate_of_id=in_progress.incident.id
        )
    assert error.value.code == "validation_error" and error.value.http_status == 422
    assert records(in_progress) == [0, 0]


def test_disposition_stale_version_has_no_side_effects(in_progress):
    with pytest.raises(WorkflowViolation) as error:
        disposition(in_progress, kind="invalid", reason="x", version=2)
    assert error.value.code == "version_conflict"
    assert in_progress.incident.version == 1 and records(in_progress) == [0, 0]


def test_transition_endpoint_returns_history_and_correlation(in_progress, assignment_client):
    in_progress.principal = in_progress.users["handler"]
    correlation = str(uuid4())
    response = assignment_client.post(
        f"/api/v1/incidents/{in_progress.incident.id}/transitions",
        json={
            "target_status": "resolved",
            "expected_version": 1,
            "resolution": "Replaced the leaking pipe",
        },
        headers={"X-Request-ID": correlation},
    )
    assert response.status_code == 200
    assert set(response.json()) == {"incident", "history_id"}
    assert response.json()["incident"]["status"] == "resolved"
    assert response.json()["incident"]["resolved_at"].endswith("Z")
    assert response.headers["X-Request-ID"] == correlation


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"target_status": "resolved", "expected_version": 0},
        {"target_status": "resolved", "expected_version": 1},
        {
            "target_status": "resolved",
            "expected_version": 1,
            "resolution": "x",
            "actor_id": "fake",
        },
    ],
)
def test_endpoint_rejects_bad_transition_payload(in_progress, assignment_client, payload):
    response = assignment_client.post(
        f"/api/v1/incidents/{in_progress.incident.id}/transitions", json=payload
    )
    assert response.status_code == 422 and response.json()["error"]["code"] == "validation_error"
    assert records(in_progress) == [0, 0]


def test_endpoint_rejects_unlisted_transition(in_progress, assignment_client):
    response = assignment_client.post(
        f"/api/v1/incidents/{in_progress.incident.id}/transitions",
        json={"target_status": "reported", "expected_version": 1, "resolution": "x", "reason": "x"},
    )
    assert response.status_code == 409 and response.json()["error"]["code"] == "invalid_transition"
    assert records(in_progress) == [0, 0]


def test_disposition_endpoint_closes_incident(in_progress, assignment_client):
    original = other_incident(in_progress)
    response = assignment_client.post(
        f"/api/v1/incidents/{in_progress.incident.id}/disposition",
        json={
            "kind": "duplicate",
            "reason": "Same leak reported twice",
            "duplicate_of_id": str(original.id),
            "expected_version": 1,
        },
    )
    assert response.status_code == 200
    assert response.json()["incident"]["status"] == "closed"
    assert response.json()["incident"]["closed_at"].endswith("Z")


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"kind": "other", "reason": "x", "expected_version": 1},
        {"kind": "duplicate", "reason": "x", "expected_version": 1},
        {"kind": "invalid", "reason": "", "expected_version": 1},
        {"kind": "invalid", "reason": "x", "expected_version": 1, "actor_id": "fake"},
    ],
)
def test_endpoint_rejects_bad_disposition_payload(in_progress, assignment_client, payload):
    response = assignment_client.post(
        f"/api/v1/incidents/{in_progress.incident.id}/disposition", json=payload
    )
    assert response.status_code == 422 and response.json()["error"]["code"] == "validation_error"
    assert records(in_progress) == [0, 0]


@pytest.mark.parametrize("path", ["transitions", "disposition"])
def test_missing_incident_returns_404(in_progress, assignment_client, path):
    payload = (
        {"target_status": "resolved", "expected_version": 1, "resolution": "x"}
        if path == "transitions"
        else {"kind": "invalid", "reason": "x", "expected_version": 1}
    )
    response = assignment_client.post(f"/api/v1/incidents/{uuid4()}/{path}", json=payload)
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


def test_endpoint_requires_authentication(in_progress, assignment_client):
    main.app.dependency_overrides.pop(get_principal)
    response = assignment_client.post(
        f"/api/v1/incidents/{in_progress.incident.id}/transitions",
        json={"target_status": "resolved", "expected_version": 1, "resolution": "x"},
    )
    assert response.status_code == 401 and response.json()["error"]["code"] == "unauthenticated"


def test_endpoint_commit_failure_rolls_back(in_progress, assignment_client, monkeypatch):
    def fail():
        raise OperationalError("commit", {}, Exception("private-credential"))

    monkeypatch.setattr(in_progress.session, "commit", fail)
    response = assignment_client.post(
        f"/api/v1/incidents/{in_progress.incident.id}/transitions",
        json={"target_status": "resolved", "expected_version": 1, "resolution": "x"},
    )
    assert response.status_code == 503 and "private-credential" not in response.text
    assert records(in_progress) == [0, 0]


@pytest.mark.parametrize(
    "role,status", [("reporter", 403), ("other_manager", 404), ("target_handler", 404)]
)
def test_endpoint_enforces_record_scope(in_progress, assignment_client, role, status):
    in_progress.principal = in_progress.users[role]
    response = assignment_client.post(
        f"/api/v1/incidents/{in_progress.incident.id}/transitions",
        json={"target_status": "resolved", "expected_version": 1, "resolution": "x"},
    )
    assert response.status_code == status and records(in_progress) == [0, 0]
