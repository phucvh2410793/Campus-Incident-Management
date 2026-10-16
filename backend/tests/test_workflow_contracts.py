import itertools
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.comments.contracts import CommentRequest
from app.workflow.contracts import (
    AcknowledgeRequest,
    AssignRequest,
    DispositionRequest,
    Status,
    TransitionRequest,
    WorkflowViolation,
    validate_transition,
)

# Expected edges copied from the API contract, not derived from implementation.
ALLOWED = {
    ("in_progress", "resolved"),
    ("resolved", "closed"),
    ("resolved", "in_progress"),
    ("closed", "in_progress"),
}


@pytest.mark.parametrize("role", ["department_manager", "administrator"])
@pytest.mark.parametrize("source,target", list(itertools.product(Status, repeat=2)))
def test_manager_transition_matrix(source, target, role):
    request = TransitionRequest(
        target_status=target, expected_version=1, reason="Review", resolution="Fixed"
    )
    if (source.value, target.value) in ALLOWED:
        validate_transition(source, role, request)
    else:
        with pytest.raises(WorkflowViolation) as caught:
            validate_transition(source, role, request)
        assert (caught.value.http_status, caught.value.code) == (409, "invalid_transition")


@pytest.mark.parametrize("role", ["reporter", "service", "unknown"])
def test_non_processing_roles_cannot_resolve(role):
    request = TransitionRequest(target_status="resolved", expected_version=1, resolution="Fix")
    with pytest.raises(WorkflowViolation) as caught:
        validate_transition(Status.IN_PROGRESS, role, request)
    assert caught.value.http_status == 403


@pytest.mark.parametrize("source,target", sorted(ALLOWED))
def test_handler_only_resolves(source, target):
    request = TransitionRequest(
        target_status=target, expected_version=1, reason="Review", resolution="Fixed"
    )
    if target == "resolved":
        validate_transition(Status(source), "handler", request)
    else:
        with pytest.raises(WorkflowViolation) as caught:
            validate_transition(Status(source), "handler", request)
        assert caught.value.http_status == 403


@pytest.mark.parametrize(
    "source,target,field",
    [
        ("in_progress", "resolved", "resolution"),
        ("resolved", "in_progress", "reason"),
        ("closed", "in_progress", "reason"),
    ],
)
@pytest.mark.parametrize("value", [None, "", "   "])
def test_required_transition_text(source, target, field, value):
    request = TransitionRequest(target_status=target, expected_version=1, **{field: value})
    with pytest.raises(WorkflowViolation) as caught:
        validate_transition(Status(source), "department_manager", request)
    assert caught.value.http_status == 422


@pytest.mark.parametrize("version", [0, -1, True, "1", 1.5])
def test_version_must_be_positive_integer(version):
    with pytest.raises(ValidationError):
        TransitionRequest(target_status="closed", expected_version=version)


@pytest.mark.parametrize("body", ["", "   ", "x" * 2001])
def test_comment_length(body):
    with pytest.raises(ValidationError):
        CommentRequest(body=body, visibility="public", expected_version=1)


def test_client_cannot_supply_actor():
    with pytest.raises(ValidationError):
        CommentRequest(body="Update", visibility="public", expected_version=1, actor_id="fake")


def test_shared_request_fixtures_match_contracts():
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "n4_workflow.json").read_text(encoding="utf-8")
    )
    for key, schema in [
        ("assign_request", AssignRequest),
        ("comment_request", CommentRequest),
        ("acknowledge_request", AcknowledgeRequest),
        ("resolve_request", TransitionRequest),
        ("reopen_request", TransitionRequest),
        ("duplicate_request", DispositionRequest),
    ]:
        schema.model_validate(fixture[key])


def test_duplicate_requires_original_incident():
    with pytest.raises(ValidationError):
        DispositionRequest(kind="duplicate", reason="Same incident", expected_version=1)


def test_invalid_disposition_does_not_require_original_incident():
    DispositionRequest(kind="invalid", reason="Invalid report", expected_version=1)
