"""N4 storage checks with isolated rows and the complete migration graph."""

import importlib.util
from io import StringIO
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.comments.models import Comment
from app.comments.repository import CommentRepository
from app.workflow.models import Assignment, AuditLog, StatusHistory
from app.workflow.repository import WorkflowRepository

TABLES = [Assignment.__table__, Comment.__table__, StatusHistory.__table__, AuditLog.__table__]


def load_migration():
    path = Path(__file__).parents[1] / "migrations" / "versions" / "n4_w2_workflow.py"
    spec = importlib.util.spec_from_file_location("n4_workflow_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def storage():
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    # SQLite exercises N4 DDL; the full migration chain is checked separately.
    for name in ("users", "departments", "incidents"):
        sa.Table(name, metadata, sa.Column("id", sa.Uuid, primary_key=True))
    for table in TABLES:
        table.to_metadata(metadata)
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        for name in ("users", "departments", "incidents"):
            metadata.tables[name].create(connection)
        migration = load_migration()
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        assert compare_metadata(MigrationContext.configure(connection), metadata) == []
        actor, department, incident, other = (uuid4() for _ in range(4))
        connection.execute(metadata.tables["users"].insert(), {"id": actor})
        connection.execute(metadata.tables["departments"].insert(), {"id": department})
        connection.execute(metadata.tables["incidents"].insert(), [{"id": incident}, {"id": other}])
        connection.commit()
        with Session(connection) as session:
            yield session, actor, department, incident, other
        connection.rollback()
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        assert set(sa.inspect(connection).get_table_names()) == {
            "users",
            "departments",
            "incidents",
        }
    engine.dispose()


def test_roundtrip_visibility_and_incident_scope(storage):
    session, actor, department, incident, other = storage
    workflow = WorkflowRepository(session)
    comments = CommentRepository(session)
    workflow.add_assignment(
        Assignment(
            incident_id=incident,
            actor_id=actor,
            department_id=department,
            handler_id=None,
            reason="Assign department",
        )
    )
    for target, visibility in [(incident, "public"), (incident, "internal"), (other, "public")]:
        comments.add(
            Comment(incident_id=target, actor_id=actor, body="Update", visibility=visibility)
        )
    for version, visibility in [(2, "public"), (3, "internal")]:
        workflow.add_history(
            StatusHistory(
                incident_id=incident,
                actor_id=actor,
                from_status="reported",
                to_status="assigned",
                incident_version=version,
                visibility=visibility,
            )
        )
    workflow.add_audit(
        AuditLog(
            incident_id=incident,
            actor_id=actor,
            action="assign",
            request_id=uuid4(),
            before={"status": "reported"},
            after={"status": "assigned"},
        )
    )
    session.commit()
    session.expire_all()
    assert len(workflow.list_assignments(incident)) == 1
    assert [c.visibility for c in comments.list_for_incident(incident)] == ["public"]
    assert len(comments.list_for_incident(incident, include_internal=True)) == 2
    assert len(comments.list_for_incident(other)) == 1
    assert len(workflow.list_history(incident)) == 1
    assert len(workflow.list_history(incident, include_internal=True)) == 2
    assert session.scalar(sa.select(sa.func.count()).select_from(AuditLog)) == 1


def test_repository_does_not_commit_and_transaction_rolls_back(storage):
    session, actor, department, incident, _ = storage
    workflow = WorkflowRepository(session)
    workflow.add_assignment(
        Assignment(
            incident_id=incident,
            actor_id=actor,
            department_id=department,
            reason="Assign",
        )
    )
    CommentRepository(session).add(
        Comment(
            incident_id=incident,
            actor_id=actor,
            body="Update",
            visibility="public",
        )
    )
    session.flush()
    session.rollback()
    assert workflow.list_assignments(incident) == []
    assert CommentRepository(session).list_for_incident(incident) == []


@pytest.mark.parametrize(
    "body,visibility",
    [("", "public"), ("  ", "public"), ("x" * 2001, "public"), ("Update", "secret")],
)
def test_database_rejects_invalid_comment(storage, body, visibility):
    session, actor, _, incident, _ = storage
    session.add(Comment(incident_id=incident, actor_id=actor, body=body, visibility=visibility))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


@pytest.mark.parametrize("field", ["incident_id", "actor_id", "department_id", "handler_id"])
def test_assignment_foreign_keys(storage, field):
    session, actor, department, incident, _ = storage
    values = dict(
        incident_id=incident,
        actor_id=actor,
        department_id=department,
        handler_id=actor,
        reason="Assign",
    )
    values[field] = uuid4()
    session.add(Assignment(**values))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_duplicate_history_version_rolls_back(storage):
    session, actor, _, incident, _ = storage
    for _ in range(2):
        session.add(
            StatusHistory(
                incident_id=incident,
                actor_id=actor,
                from_status="reported",
                to_status="assigned",
                incident_version=2,
            )
        )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()
    assert WorkflowRepository(session).list_history(incident) == []


def test_audit_rejects_sensitive_details(storage):
    session, actor, _, incident, _ = storage
    with pytest.raises(ValueError):
        WorkflowRepository(session).add_audit(
            AuditLog(
                incident_id=incident,
                actor_id=actor,
                action="assign",
                request_id=uuid4(),
                before={},
                after={"body": "private comment"},
            )
        )


def test_pagination_is_bounded_and_stable(storage):
    session, actor, _, incident, _ = storage
    repo = CommentRepository(session)
    for _ in range(3):
        repo.add(Comment(incident_id=incident, actor_id=actor, body="Update", visibility="public"))
    session.flush()
    all_ids = [row.id for row in repo.list_for_incident(incident)]
    pages = [repo.list_for_incident(incident, limit=1, offset=i)[0].id for i in range(3)]
    assert all_ids == pages
    with pytest.raises(ValueError):
        repo.list_for_incident(incident, limit=101)
    with pytest.raises(ValueError):
        WorkflowRepository(session).list_assignments(incident, offset=-1)


def test_postgresql_migration_sql_contains_foreign_keys_and_indexes():
    buffer = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": buffer}
    )
    with Operations.context(context):
        load_migration().upgrade()
    sql = buffer.getvalue()
    assert sql.count("CREATE TABLE") == 4
    assert sql.count("REFERENCES incidents (id)") == 4
    assert "ix_assignments_handler_id" in sql
    assert "TIMESTAMP WITH TIME ZONE" in sql


def test_n4_migration_is_the_only_head_and_models_are_registered():
    from app import models  # noqa: F401
    from app.db import Base

    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    assert scripts.get_heads() == ["n4_w2_workflow"]
    assert {table.name for table in TABLES} <= set(Base.metadata.tables)


def test_system_workflow_record_and_comment_actor_constraint(storage):
    session, actor, department, incident, _ = storage
    session.add(
        Assignment(
            incident_id=incident,
            actor_id=None,
            department_id=department,
            reason="Automated triage",
        )
    )
    session.flush()
    session.add(Comment(incident_id=incident, actor_id=None, body="Update", visibility="public"))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()
