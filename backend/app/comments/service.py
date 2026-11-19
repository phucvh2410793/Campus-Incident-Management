"""Comment operations using W2 storage and caller-owned transactions.

No HTTP routes or commits here. A savepoint keeps version/comment/audit together
if validation or persistence fails. The caller commits the enclosing transaction.
"""

from datetime import UTC
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.auth.policy import Principal
from app.comments.contracts import CommentRequest
from app.comments.logic import (
    CommentData,
    prepare_comment,
    require_incident_access,
    serialize_comment,
)
from app.comments.models import Comment
from app.comments.repository import CommentRepository
from app.incidents.models import Incident
from app.workflow.contracts import WorkflowViolation
from app.workflow.models import AuditLog
from app.workflow.repository import WorkflowRepository


class CommentService:
    def __init__(self, session: Session):
        self.session = session
        self.comments = CommentRepository(session)

    def _incident(self, principal: Principal, incident_id: UUID) -> Incident:
        incident = self.session.get(Incident, incident_id, populate_existing=True)
        if incident is None:
            raise WorkflowViolation("not_found", 404)
        require_incident_access(principal, incident)
        return incident

    def create(
        self,
        principal: Principal,
        incident_id: UUID,
        request: CommentRequest,
        *,
        request_id: UUID,
    ) -> dict:
        with self.session.begin_nested():
            incident = self._incident(principal, incident_id)
            prepared = prepare_comment(principal, incident, request)
            # Compare-and-swap at the database boundary, not just in Python.
            result = self.session.execute(
                update(Incident)
                .where(
                    Incident.id == incident_id,
                    Incident.version == request.expected_version,
                )
                .values(version=Incident.version + 1)
            )
            if result.rowcount != 1:
                raise WorkflowViolation("version_conflict", 409)
            self.comments.add(Comment(**prepared.model_dump()))
            WorkflowRepository(self.session).add_audit(
                AuditLog(
                    incident_id=incident_id,
                    actor_id=prepared.actor_id,
                    action="comment.created",
                    request_id=request_id,
                    before={"version": request.expected_version},
                    after={"version": request.expected_version + 1},
                )
            )
            self.session.flush()
            response = serialize_comment(principal, incident, prepared)
            response["incident_version"] = request.expected_version + 1
        return response

    def list_for_incident(
        self,
        principal: Principal,
        incident_id: UUID,
        *,
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict]:
        incident = self._incident(principal, incident_id)
        records = self.comments.list_for_incident(
            incident_id,
            include_internal=principal.role != "reporter",
            limit=limit,
            offset=offset,
        )
        result = []
        for record in records:
            data = CommentData.model_validate(record)
            # SQLite test storage drops timezone offsets; stored timestamps are UTC.
            if data.created_at.tzinfo is None:
                data = data.model_copy(update={"created_at": data.created_at.replace(tzinfo=UTC)})
            result.append(serialize_comment(principal, incident, data))
        return result
