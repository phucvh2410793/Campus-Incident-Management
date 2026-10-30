"""Repository integration with real models; SQLite stands in for PostgreSQL."""

import json
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles, deregister
from sqlalchemy.orm import Session

from app.auth.policy import Principal
from app.comments.contracts import CommentRequest
from app.comments.models import Comment
from app.comments.service import CommentService
from app.incidents.models import Incident
from app.models import Department, User
from app.workflow.contracts import WorkflowViolation
from app.workflow.models import AuditLog


@pytest.fixture
def stored():
    # Keep PostgreSQL JSONB production models unchanged; test-only compilation.
    compiles(JSONB, "sqlite")(lambda element, compiler, **kw: "JSON")
    engine = sa.create_engine("sqlite://")
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
                Comment.__table__,
                AuditLog.__table__,
            ],
        )
        connection.commit()
        with Session(connection, expire_on_commit=False) as session:
            department, reporter, handler, admin = (uuid4() for _ in range(4))
            session.add(Department(id=department, name="Test department"))
            session.flush()
            for uid, role in [
                (reporter, "reporter"),
                (handler, "handler"),
                (admin, "administrator"),
            ]:
                session.add(
                    User(
                        id=uid,
                        email=f"{uid}@example.com",
                        display_name=role,
                        password_hash="test-only",
                        role=role,
                        is_active=True,
                        department_id=department if role == "handler" else None,
                    )
                )
            session.flush()
            incident = Incident(
                id=uuid4(),
                reporter_id=reporter,
                category="water_leak",
                title="Water leak",
                description="Water near a classroom door",
                building="A",
                answers={},
                department_id=department,
                assigned_handler_id=handler,
                status="assigned",
                version=1,
            )
            session.add(incident)
            session.commit()
            principals = {
                "reporter": Principal(str(reporter), "reporter", None),
                "handler": Principal(str(handler), "handler", str(department)),
                "admin": Principal(str(admin), "administrator", None),
            }
            # SQLite requires a physical outer transaction before SAVEPOINT so
            # releasing it cannot commit writes behind the caller's back.
            connection.exec_driver_sql("BEGIN")
            yield session, incident, principals
            session.rollback()
    engine.dispose()
    deregister(JSONB)


def test_create_and_read_public_internal_with_real_repository(stored):
    session, incident, principals = stored
    service = CommentService(session)
    for visibility, version in [("public", 1), ("internal", 2)]:
        response = service.create(
            principals["handler"],
            incident.id,
            CommentRequest(body="<b>Update</b>", visibility=visibility, expected_version=version),
            request_id=uuid4(),
        )
        assert response["incident_version"] == version + 1
        assert response["body"] == "&lt;b&gt;Update&lt;/b&gt;"
    session.expire_all()
    assert [
        r["visibility"] for r in service.list_for_incident(principals["reporter"], incident.id)
    ] == ["public"]
    assert len(service.list_for_incident(principals["handler"], incident.id)) == 2
    assert session.scalar(sa.select(Comment.body).limit(1)) == "<b>Update</b>"
    assert session.scalar(sa.select(sa.func.count()).select_from(AuditLog)) == 2


def test_reporter_internal_is_denied_without_writes(stored):
    session, incident, principals = stored
    with pytest.raises(WorkflowViolation) as error:
        CommentService(session).create(
            principals["reporter"],
            incident.id,
            CommentRequest(body="Private", visibility="internal", expected_version=1),
            request_id=uuid4(),
        )
    assert error.value.http_status == 403
    assert session.get(Incident, incident.id).version == 1
    assert session.scalar(sa.select(sa.func.count()).select_from(Comment)) == 0


def test_duplicate_version_has_one_success_and_one_conflict(stored):
    session, incident, principals = stored
    service = CommentService(session)
    request = CommentRequest(body="Update", visibility="public", expected_version=1)
    service.create(principals["admin"], incident.id, request, request_id=uuid4())
    with pytest.raises(WorkflowViolation) as error:
        service.create(principals["handler"], incident.id, request, request_id=uuid4())
    assert (error.value.code, error.value.http_status) == ("version_conflict", 409)
    assert session.scalar(sa.select(sa.func.count()).select_from(Comment)) == 1
    assert session.scalar(sa.select(sa.func.count()).select_from(AuditLog)) == 1


def test_audit_failure_rolls_back_comment_and_version(stored, monkeypatch):
    session, incident, principals = stored
    from app.workflow.repository import WorkflowRepository

    def fail(*args):
        raise RuntimeError("Simulated audit failure")

    monkeypatch.setattr(WorkflowRepository, "add_audit", fail)
    with pytest.raises(RuntimeError):
        CommentService(session).create(
            principals["admin"],
            incident.id,
            CommentRequest(body="Update", visibility="public", expected_version=1),
            request_id=uuid4(),
        )
    assert session.get(Incident, incident.id, populate_existing=True).version == 1
    assert session.scalar(sa.select(sa.func.count()).select_from(Comment)) == 0


def test_caller_rollback_removes_all_changes(stored):
    session, incident, principals = stored
    incident_id = incident.id
    CommentService(session).create(
        principals["admin"],
        incident_id,
        CommentRequest(body="Update", visibility="internal", expected_version=1),
        request_id=uuid4(),
    )
    session.rollback()
    assert session.get(Incident, incident_id).version == 1
    assert session.scalar(sa.select(sa.func.count()).select_from(Comment)) == 0
    assert session.scalar(sa.select(sa.func.count()).select_from(AuditLog)) == 0


def test_cross_incident_is_hidden_at_service_boundary(stored):
    session, incident, _ = stored
    stranger = Principal(str(uuid4()), "reporter", None)
    with pytest.raises(WorkflowViolation) as error:
        CommentService(session).list_for_incident(stranger, incident.id)
    assert error.value.http_status == 404
