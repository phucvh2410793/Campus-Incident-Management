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

from app.auth.policy import IncidentPolicy, Principal
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
    """Keep the existing comment service interface backed by N1's shared policy."""
    decision = IncidentPolicy().evaluate(principal, incident, "view")
    if not decision.allowed:
        raise WorkflowViolation(decision.code, decision.http_status)


def prepare_comment(
    principal: Principal,
    incident: Incident,
    request: CommentRequest,
) -> CommentData:
    """Validate a new comment and derive its actor; does not write to the DB.

    Keep body raw in storage. Escaping belongs only at the output boundary.
    """
    action = "comment_internal" if request.visibility == "internal" else "comment_public"
    decision = IncidentPolicy().evaluate(principal, incident, action)
    if not decision.allowed:
        raise WorkflowViolation(decision.code, decision.http_status)
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
    if comment.incident_id != incident.id or comment.visibility not in {"public", "internal"}:
        raise WorkflowViolation("not_found", 404)
    if comment.visibility == "internal":
        decision = IncidentPolicy().evaluate(principal, incident, "read_internal_comment")
        if not decision.allowed:
            raise WorkflowViolation(decision.code, decision.http_status)
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
    can_read_internal = (
        IncidentPolicy().evaluate(principal, incident, "read_internal_comment").allowed
    )
    return [
        serialize_comment(principal, incident, comment)
        for comment in comments
        if comment.incident_id == incident.id
        and (
            comment.visibility == "public"
            or (comment.visibility == "internal" and can_read_internal)
        )
    ]
