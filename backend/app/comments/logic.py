"""W3 comment preparation and serialization, independent of persistence.

Accepts N1 Principal and N2 Incident (including unsaved fixtures). Authorization
is checked on every entry point, including direct serialization. Later services
must persist the prepared fields, increment version and write audit atomically;
the version check here does not replace a conditional database UPDATE.
"""

from datetime import UTC, datetime
from html import escape
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict

from app.auth.policy import Principal
from app.comments.contracts import CommentRequest
from app.incidents.models import Incident
from app.workflow.contracts import WorkflowViolation


class CommentData(BaseModel):
    """Raw storage fields, also loadable from a W2 Comment ORM object."""

    model_config = ConfigDict(from_attributes=True, frozen=True, extra="ignore")

    id: UUID
    incident_id: UUID
    actor_id: UUID
    body: str
    visibility: Literal["public", "internal"]
    created_at: datetime


def require_incident_access(principal: Principal, incident: Incident) -> None:
    """N4 record-scope guard until N1's shared record policy is integrated."""
    actor = principal.user_id
    department = principal.department_id
    allowed = (
        principal.role == "administrator"
        or (principal.role == "reporter" and actor == str(incident.reporter_id))
        or (
            principal.role == "handler"
            and actor == str(incident.assigned_handler_id)
            and department is not None
            and department == str(incident.department_id)
        )
        or (
            principal.role == "department_manager"
            and department is not None
            and department == str(incident.department_id)
        )
    )
    if not allowed:
        raise WorkflowViolation("not_found", 404)


def prepare_comment(
    principal: Principal,
    incident: Incident,
    request: CommentRequest,
) -> CommentData:
    """Validate a new comment and derive its actor; does not write to the DB.

    Keep body raw in storage. Escaping belongs only at the output boundary.
    """
    require_incident_access(principal, incident)
    if request.visibility == "internal" and principal.role == "reporter":
        raise WorkflowViolation("forbidden", 403)
    if request.expected_version != incident.version:
        raise WorkflowViolation("version_conflict", 409)
    return CommentData(
        id=uuid4(),
        incident_id=incident.id,
        actor_id=UUID(principal.user_id),
        body=request.body,
        visibility=request.visibility,
        created_at=datetime.now(UTC),
    )


def serialize_comment(principal: Principal, incident: Incident, comment) -> dict:
    """Return whitelisted fields and escaped text; never return hidden records."""
    require_incident_access(principal, incident)
    # Inspect scope/visibility before reading the body or validating other fields.
    if comment.incident_id != incident.id or (
        comment.visibility != "public"
        and (comment.visibility != "internal" or principal.role == "reporter")
    ):
        raise WorkflowViolation("not_found", 404)
    data = CommentData.model_validate(comment)
    if data.created_at.tzinfo is None or data.created_at.utcoffset() is None:
        raise ValueError("Comment timestamp must include timezone")
    result = data.model_dump(mode="json")
    result["body"] = escape(data.body, quote=True)
    result["created_at"] = data.created_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    return result


def serialize_comments(principal: Principal, incident: Incident, comments) -> list[dict]:
    """Filter visibility defensively even when the repository supplied all rows."""
    require_incident_access(principal, incident)
    return [
        serialize_comment(principal, incident, comment)
        for comment in comments
        if comment.incident_id == incident.id
        and (
            comment.visibility == "public"
            or (comment.visibility == "internal" and principal.role != "reporter")
        )
    ]
