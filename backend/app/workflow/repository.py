"""N4 storage operations. Caller authorizes record scope and owns the transaction.

Repositories never commit: services must write incident/version, history, audit
and outbox atomically. Pagination here is internal, not the HTTP cursor contract.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.workflow.models import Assignment, AuditLog, StatusHistory


class WorkflowRepository:
    def __init__(self, session: Session):
        self.session = session

    def add_assignment(self, assignment: Assignment) -> None:
        self.session.add(assignment)

    def add_history(self, history: StatusHistory) -> None:
        self.session.add(history)

    def add_audit(self, audit: AuditLog) -> None:
        # Only structured workflow metadata; never comment/file bodies or secrets.
        allowed = {"status", "department_id", "assigned_handler_id", "version"}
        for values in (audit.before, audit.after):
            if set(values) - allowed:
                raise ValueError("Unsupported audit fields")
            for key, value in values.items():
                if key == "status" and value not in {
                    "reported",
                    "assigned",
                    "in_progress",
                    "resolved",
                    "closed",
                }:
                    raise ValueError("Invalid audit status")
                if key == "version" and (type(value) is not int or value < 1):
                    raise ValueError("Invalid audit version")
                if key in {"department_id", "assigned_handler_id"} and value is not None:
                    UUID(value)
        self.session.add(audit)

    def list_assignments(self, incident_id: UUID, *, limit: int = 20, offset: int = 0):
        return self._list(Assignment, incident_id, limit, offset)

    def list_history(
        self,
        incident_id: UUID,
        *,
        include_internal: bool = False,
        limit: int = 20,
        offset: int = 0,
    ):
        return self._list(StatusHistory, incident_id, limit, offset, include_internal)

    def _list(self, model, incident_id, limit, offset, include_internal=True):
        if not 1 <= limit <= 100 or offset < 0:
            raise ValueError("Invalid pagination")
        query = select(model).where(model.incident_id == incident_id)
        if not include_internal:
            query = query.where(model.visibility == "public")
        return list(
            self.session.scalars(
                query.order_by(model.created_at, model.id).limit(limit).offset(offset)
            )
        )
