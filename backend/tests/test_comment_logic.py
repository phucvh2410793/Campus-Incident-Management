from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.auth.policy import Principal
from app.comments.contracts import CommentRequest
from app.comments.logic import (
    CommentData,
    prepare_comment,
    serialize_comment,
    serialize_comments,
)
from app.incidents.models import Incident
from app.workflow.contracts import WorkflowViolation


@pytest.fixture
def case():
    reporter, handler, department = uuid4(), uuid4(), uuid4()
    incident = Incident(
        id=uuid4(),
        reporter_id=reporter,
        assigned_handler_id=handler,
        department_id=department,
        version=3,
        status="assigned",
    )
    principals = {
        "reporter": Principal(str(reporter), "reporter", None),
        "handler": Principal(str(handler), "handler", str(department)),
        "manager": Principal(str(uuid4()), "department_manager", str(department)),
        "admin": Principal(str(uuid4()), "administrator", None),
        "other_reporter": Principal(str(uuid4()), "reporter", None),
        "other_handler": Principal(str(uuid4()), "handler", str(department)),
        "other_manager": Principal(str(uuid4()), "department_manager", str(uuid4())),
        "unknown": Principal(str(uuid4()), "unknown", str(department)),
        "service": Principal(str(uuid4()), "service", None),
    }
    return incident, principals


def comment(incident, visibility="public", body="Progress update"):
    return CommentData(
        id=uuid4(),
        incident_id=incident.id,
        actor_id=uuid4(),
        body=body,
        visibility=visibility,
        created_at=datetime.now(UTC),
    )


@pytest.mark.parametrize("role", ["reporter", "handler", "manager", "admin"])
@pytest.mark.parametrize("visibility", ["public", "internal"])
def test_creation_permissions(case, role, visibility):
    incident, principals = case
    request = CommentRequest(body="Update", visibility=visibility, expected_version=3)
    if role == "reporter" and visibility == "internal":
        with pytest.raises(WorkflowViolation) as error:
            prepare_comment(principals[role], incident, request)
        assert (error.value.code, error.value.http_status) == ("forbidden", 403)
    else:
        result = prepare_comment(principals[role], incident, request)
        assert str(result.actor_id) == principals[role].user_id
        assert result.incident_id == incident.id
        assert result.visibility == visibility
        assert incident.version == 3  # Preparation is not a database write.


@pytest.mark.parametrize(
    "role", ["other_reporter", "other_handler", "other_manager", "unknown", "service"]
)
@pytest.mark.parametrize("operation", ["prepare", "serialize", "list"])
def test_out_of_scope_is_hidden(case, role, operation):
    incident, principals = case
    with pytest.raises(WorkflowViolation) as error:
        if operation == "prepare":
            prepare_comment(
                principals[role],
                incident,
                CommentRequest(body="Update", visibility="public", expected_version=3),
            )
        elif operation == "serialize":
            serialize_comment(principals[role], incident, comment(incident))
        else:
            serialize_comments(principals[role], incident, [])
    assert (error.value.code, error.value.http_status) == ("not_found", 404)


def test_reporter_cannot_read_internal_by_direct_serializer_call(case):
    incident, principals = case
    # Hidden body is not even accessed by the serializer.
    hidden = SimpleNamespace(incident_id=incident.id, visibility="internal")
    with pytest.raises(WorkflowViolation) as error:
        serialize_comment(principals["reporter"], incident, hidden)
    assert error.value.http_status == 404


@pytest.mark.parametrize("role", ["reporter", "handler", "manager", "admin"])
def test_list_filters_visibility_and_other_incidents(case, role):
    incident, principals = case
    public, internal = comment(incident), comment(incident, "internal")
    unrelated = public.model_copy(update={"incident_id": uuid4()})
    result = serialize_comments(principals[role], incident, [public, internal, unrelated])
    assert [x["visibility"] for x in result] == (
        ["public"] if role == "reporter" else ["public", "internal"]
    )


@pytest.mark.parametrize("role", ["reporter", "handler", "manager", "admin"])
def test_direct_serializer_rejects_cross_incident(case, role):
    incident, principals = case
    unrelated = comment(incident).model_copy(update={"incident_id": uuid4()})
    with pytest.raises(WorkflowViolation) as error:
        serialize_comment(principals[role], incident, unrelated)
    assert error.value.http_status == 404


def test_script_is_escaped_at_output_without_mutating_storage(case):
    incident, principals = case
    raw = '<script>alert("x")</script> & <img src=x onerror=alert(1)>'
    record = prepare_comment(
        principals["handler"],
        incident,
        CommentRequest(body=raw, visibility="public", expected_version=3),
    )
    result = serialize_comment(principals["reporter"], incident, record)
    assert record.body == raw
    assert "<" not in result["body"] and ">" not in result["body"]
    assert "&lt;script&gt;" in result["body"] and "&quot;x&quot;" in result["body"]
    assert serialize_comment(principals["reporter"], incident, record) == result


def test_serializer_only_returns_whitelisted_fields(case):
    incident, principals = case
    values = comment(incident).model_dump()
    record = SimpleNamespace(**values, internal_note="secret", password_hash="secret")
    result = serialize_comment(principals["reporter"], incident, record)
    assert set(result) == {"id", "incident_id", "actor_id", "body", "visibility", "created_at"}
    assert "secret" not in str(result)


def test_old_handler_loses_access_after_reassignment(case):
    incident, principals = case
    incident.assigned_handler_id = uuid4()
    with pytest.raises(WorkflowViolation):
        serialize_comments(principals["handler"], incident, [comment(incident)])


@pytest.mark.parametrize("role", ["handler", "manager"])
def test_old_department_loses_access(case, role):
    incident, principals = case
    incident.department_id = uuid4()
    with pytest.raises(WorkflowViolation):
        serialize_comment(principals[role], incident, comment(incident))


def test_null_department_is_not_a_shared_scope(case):
    incident, _ = case
    incident.department_id = None
    with pytest.raises(WorkflowViolation):
        serialize_comments(Principal(str(uuid4()), "department_manager", None), incident, [])


def test_stale_version_is_rejected(case):
    incident, principals = case
    with pytest.raises(WorkflowViolation) as error:
        prepare_comment(
            principals["admin"],
            incident,
            CommentRequest(body="Update", visibility="public", expected_version=2),
        )
    assert (error.value.code, error.value.http_status) == ("version_conflict", 409)


@pytest.mark.parametrize("body", ["", "   ", "x" * 2001])
def test_invalid_body_is_rejected(body):
    with pytest.raises(ValidationError):
        CommentRequest(body=body, visibility="public", expected_version=1)


def test_unicode_and_line_breaks_are_preserved(case):
    incident, principals = case
    raw = "Đã kiểm tra đường ống.\nChờ thay thiết bị."
    assert (
        serialize_comment(principals["reporter"], incident, comment(incident, body=raw))["body"]
        == raw
    )


def test_timestamp_is_normalized_to_utc(case):
    incident, principals = case
    record = comment(incident).model_copy(
        update={"created_at": datetime(2026, 10, 26, 9, tzinfo=timezone(timedelta(hours=7)))}
    )
    assert serialize_comment(principals["reporter"], incident, record)["created_at"] == (
        "2026-10-26T02:00:00Z"
    )


def test_naive_timestamp_is_rejected(case):
    incident, principals = case
    record = comment(incident).model_copy(update={"created_at": datetime(2026, 10, 26)})
    with pytest.raises(ValueError):
        serialize_comment(principals["reporter"], incident, record)
