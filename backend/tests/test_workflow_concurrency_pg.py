"""PostgreSQL concurrency checks for N4 commands (W7).

SQLite tests prove the conditional UPDATE mechanism; only real PostgreSQL
proves two concurrent transactions cannot both commit the same version.
Requires TEST_DATABASE_URL pointing at campus_incident_test (see
docs/development.md). Each test seeds its own incident and deletes it after.
"""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.auth.policy import Principal
from app.automation.models import OutboxEvent
from app.comments.contracts import CommentRequest
from app.comments.models import Comment
from app.comments.service import CommentService
from app.incidents.models import Incident
from app.models import Department, User
from app.workflow.contracts import (
    AcknowledgeRequest,
    AssignRequest,
    DispositionRequest,
    TransitionRequest,
    WorkflowViolation,
)
from app.workflow.models import Assignment, AuditLog, StatusHistory
from app.workflow.service import (
    AcknowledgmentService,
    AssignmentService,
    DispositionService,
    TransitionService,
)

NOW = datetime(2026, 11, 21, 16, 0, tzinfo=UTC)


@pytest.fixture
def pg_case(test_engine):
    """Seed one incident plus users on PostgreSQL; delete everything after."""
    factory = sessionmaker(bind=test_engine)
    suffix = uuid4().hex[:8]
    current, target = uuid4(), uuid4()
    users: dict[str, Principal] = {}
    incident_id = uuid4()
    with factory() as session:
        session.add_all(
            [
                Department(id=current, name=f"Source-{suffix}"),
                Department(id=target, name=f"Target-{suffix}"),
            ]
        )
        session.flush()
        for name, role, department in [
            ("reporter", "reporter", None),
            ("handler", "handler", current),
            ("target_handler", "handler", target),
            ("manager", "department_manager", current),
            ("admin", "administrator", None),
        ]:
            user_id = uuid4()
            session.add(
                User(
                    id=user_id,
                    email=f"{user_id}@example.com",
                    display_name=name,
                    password_hash="test-only",
                    role=role,
                    department_id=department,
                    is_active=True,
                )
            )
            users[name] = Principal(str(user_id), role, str(department) if department else None)
        session.flush()
        session.add(
            Incident(
                id=incident_id,
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
                acknowledgment_deadline_at=NOW + timedelta(minutes=15),
            )
        )
        session.commit()
    case = SimpleNamespace(
        factory=factory,
        incident_id=incident_id,
        users=users,
        current=current,
        target=target,
    )
    yield case
    with factory() as session:
        session.execute(sa.delete(StatusHistory).where(StatusHistory.incident_id == incident_id))
        session.execute(sa.delete(AuditLog).where(AuditLog.incident_id == incident_id))
        session.execute(sa.delete(Assignment).where(Assignment.incident_id == incident_id))
        session.execute(sa.delete(Comment).where(Comment.incident_id == incident_id))
        session.execute(sa.delete(OutboxEvent).where(OutboxEvent.incident_id == incident_id))
        session.execute(sa.delete(Incident).where(Incident.id == incident_id))
        session.execute(
            sa.delete(User).where(User.id.in_([UUID(p.user_id) for p in users.values()]))
        )
        session.execute(sa.delete(Department).where(Department.id.in_([current, target])))
        session.commit()


def set_status(case, status, **extra):
    with case.factory() as session:
        incident = session.get(Incident, case.incident_id)
        incident.status = status
        for key, value in extra.items():
            setattr(incident, key, value)
        session.commit()


def run_concurrent(case, calls):
    """Run each call in its own thread and session; return (ok, conflicts)."""
    barrier = threading.Barrier(len(calls))
    results = []

    def worker(call):
        session = case.factory()
        try:
            barrier.wait(timeout=30)
            result = call(session)
            session.commit()
            results.append(("ok", result))
        except WorkflowViolation as error:
            session.rollback()
            results.append(("conflict", error.code))
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        futures = [pool.submit(worker, call) for call in calls]
        for future in futures:
            future.result(timeout=30)
    ok = [result for kind, result in results if kind == "ok"]
    conflicts = [code for kind, code in results if kind == "conflict"]
    return ok, conflicts


def final_state(case):
    with case.factory() as session:
        incident = session.get(Incident, case.incident_id)
        history = session.scalar(
            sa.select(sa.func.count())
            .select_from(StatusHistory)
            .where(StatusHistory.incident_id == case.incident_id)
        )
        audit = session.scalar(
            sa.select(sa.func.count())
            .select_from(AuditLog)
            .where(AuditLog.incident_id == case.incident_id)
        )
        return incident, history, audit


def test_concurrent_resolve_only_one_wins(pg_case):
    set_status(pg_case, "in_progress", acknowledged_at=NOW - timedelta(minutes=5))

    def resolve(session):
        return TransitionService(session).transition(
            pg_case.users["handler"],
            pg_case.incident_id,
            TransitionRequest(target_status="resolved", expected_version=1, resolution="Fixed"),
            request_id=uuid4(),
        )

    ok, conflicts = run_concurrent(pg_case, [resolve, resolve])
    assert len(ok) == 1
    assert conflicts == ["version_conflict"]
    incident, history, audit = final_state(pg_case)
    assert incident.status == "resolved"
    assert incident.version == 2
    assert (history, audit) == (1, 1)


def test_concurrent_acknowledge_only_one_wins(pg_case):
    set_status(pg_case, "assigned")

    def acknowledge(session):
        return AcknowledgmentService(session).acknowledge(
            pg_case.users["handler"],
            pg_case.incident_id,
            AcknowledgeRequest(expected_version=1),
            request_id=uuid4(),
        )

    ok, conflicts = run_concurrent(pg_case, [acknowledge, acknowledge])
    assert len(ok) == 1
    assert conflicts == ["version_conflict"]
    incident, history, audit = final_state(pg_case)
    assert incident.status == "in_progress"
    assert incident.version == 2
    assert incident.acknowledged_at is not None
    assert (history, audit) == (1, 1)


def test_concurrent_disposition_only_one_wins(pg_case):
    set_status(pg_case, "in_progress", acknowledged_at=NOW - timedelta(minutes=5))

    def dispose(session):
        return DispositionService(session).disposition(
            pg_case.users["manager"],
            pg_case.incident_id,
            DispositionRequest(kind="invalid", reason="Not a real incident", expected_version=1),
            request_id=uuid4(),
        )

    ok, conflicts = run_concurrent(pg_case, [dispose, dispose])
    assert len(ok) == 1
    assert conflicts == ["version_conflict"]
    incident, history, audit = final_state(pg_case)
    assert incident.status == "closed"
    assert incident.version == 2
    assert (history, audit) == (1, 1)


def test_concurrent_assign_only_one_wins(pg_case):
    # An administrator keeps record access after the department changes, so
    # the losing request can be checked specifically for a stale version.
    def assign(session):
        return AssignmentService(session).assign(
            pg_case.users["admin"],
            pg_case.incident_id,
            AssignRequest(
                department_id=pg_case.target,
                handler_id=UUID(pg_case.users["target_handler"].user_id),
                reason="Move to target team",
                expected_version=1,
            ),
            request_id=uuid4(),
        )

    ok, conflicts = run_concurrent(pg_case, [assign, assign])
    assert len(ok) == 1
    assert conflicts == ["version_conflict"]
    incident, history, audit = final_state(pg_case)
    assert incident.status == "assigned"
    assert incident.version == 2
    assert incident.department_id == pg_case.target
    assert (history, audit) == (1, 1)


def test_concurrent_comment_only_one_wins(pg_case):
    set_status(pg_case, "in_progress", acknowledged_at=NOW - timedelta(minutes=5))

    def comment(session):
        return CommentService(session).create(
            pg_case.users["handler"],
            pg_case.incident_id,
            CommentRequest(body="Looking into it", visibility="public", expected_version=1),
            request_id=uuid4(),
        )

    ok, conflicts = run_concurrent(pg_case, [comment, comment])
    assert len(ok) == 1
    assert conflicts == ["version_conflict"]
    incident, history, audit = final_state(pg_case)
    assert incident.version == 2
    assert (history, audit) == (0, 1)


def test_concurrent_mixed_commands_second_sees_new_version(pg_case):
    # Different commands racing on the same version: the version gate, not the
    # command type, decides the loser.
    set_status(pg_case, "in_progress", acknowledged_at=NOW - timedelta(minutes=5))

    def resolve(session):
        return TransitionService(session).transition(
            pg_case.users["handler"],
            pg_case.incident_id,
            TransitionRequest(target_status="resolved", expected_version=1, resolution="Fixed"),
            request_id=uuid4(),
        )

    def dispose(session):
        return DispositionService(session).disposition(
            pg_case.users["manager"],
            pg_case.incident_id,
            DispositionRequest(kind="invalid", reason="Not a real incident", expected_version=1),
            request_id=uuid4(),
        )

    ok, conflicts = run_concurrent(pg_case, [resolve, dispose])
    assert len(ok) == 1
    assert conflicts == ["version_conflict"]
    incident, history, audit = final_state(pg_case)
    assert incident.status in {"resolved", "closed"}
    assert incident.version == 2
    assert (history, audit) == (1, 1)
