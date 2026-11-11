"""W4 assignment commands. The caller commits; failures roll back the savepoint."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth.policy import IncidentPolicy, Principal
from app.automation.publisher import OutboxEventPublisher
from app.automation.schemas import EventType
from app.incidents.models import Incident
from app.models import Department, User
from app.rules.engine import MANUAL_QUEUE
from app.workflow.contracts import AssignRequest, WorkflowViolation
from app.workflow.models import Assignment, AuditLog, StatusHistory
from app.workflow.repository import WorkflowRepository
from app.workflow.schemas import AssignmentIncident, AssignmentResponse


def assignment_snapshot(incident: Incident) -> dict:
    return {
        "status": incident.status,
        "version": incident.version,
        "department_id": str(incident.department_id) if incident.department_id else None,
        "assigned_handler_id": (
            str(incident.assigned_handler_id) if incident.assigned_handler_id else None
        ),
    }


class AssignmentService:
    def __init__(self, session: Session):
        self.session = session

    def assign(
        self,
        principal: Principal,
        incident_id: UUID,
        payload: AssignRequest,
        *,
        request_id: UUID,
    ) -> AssignmentResponse:
        with self.session.begin_nested():
            incident = self.session.get(Incident, incident_id, populate_existing=True)
            if incident is None:
                raise WorkflowViolation("not_found", 404)
            decision = IncidentPolicy().evaluate(principal, incident, "assign")
            if not decision.allowed:
                raise WorkflowViolation(decision.code, decision.http_status)
            if incident.version != payload.expected_version:
                raise WorkflowViolation("version_conflict", 409)
            if incident.status not in {"reported", "assigned", "in_progress"}:
                raise WorkflowViolation("invalid_transition", 409)

            # Hold shared locks so a target cannot be removed/disabled/moved
            # between validation and commit. PostgreSQL enforces these locks.
            department = self.session.scalar(
                select(Department)
                .where(Department.id == payload.department_id)
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            )
            if department is None or department.name.casefold() in {
                "triage_queue",
                MANUAL_QUEUE.casefold(),
            }:
                raise WorkflowViolation("validation_error", 422)
            if payload.handler_id is not None:
                handler = self.session.scalar(
                    select(User)
                    .where(User.id == payload.handler_id)
                    .with_for_update(read=True)
                    .execution_options(populate_existing=True)
                )
                if (
                    handler is None
                    or not handler.is_active
                    or handler.role != "handler"
                    or handler.department_id != payload.department_id
                ):
                    raise WorkflowViolation("validation_error", 422)

            before = assignment_snapshot(incident)
            now = datetime.now(UTC)
            status = "assigned" if incident.status == "reported" else incident.status
            result = self.session.execute(
                update(Incident)
                .where(
                    Incident.id == incident_id,
                    Incident.version == payload.expected_version,
                    Incident.department_id == incident.department_id,
                    Incident.status == incident.status,
                )
                .values(
                    department_id=payload.department_id,
                    assigned_handler_id=payload.handler_id,
                    status=status,
                    triage_required=False,
                    version=Incident.version + 1,
                    assigned_at=incident.assigned_at or now,
                )
                .execution_options(synchronize_session=False)
            )
            if result.rowcount != 1:
                raise WorkflowViolation("version_conflict", 409)

            repository = WorkflowRepository(self.session)
            assignment = Assignment(
                incident_id=incident_id,
                actor_id=UUID(principal.user_id),
                department_id=payload.department_id,
                handler_id=payload.handler_id,
                reason=payload.reason,
                created_at=now,
            )
            repository.add_assignment(assignment)
            if before["status"] != status:
                repository.add_history(
                    StatusHistory(
                        incident_id=incident_id,
                        actor_id=UUID(principal.user_id),
                        from_status=before["status"],
                        to_status=status,
                        incident_version=payload.expected_version + 1,
                        reason=payload.reason,
                        visibility="public",
                        created_at=now,
                    )
                )
            self.session.refresh(incident)
            repository.add_audit(
                AuditLog(
                    incident_id=incident_id,
                    actor_id=UUID(principal.user_id),
                    action="incident.assigned",
                    request_id=request_id,
                    created_at=now,
                    before=before,
                    after=assignment_snapshot(incident),
                )
            )
            OutboxEventPublisher(self.session).create_and_publish(
                EventType.INCIDENT_ASSIGNED,
                incident_id,
                request_id,
                occurred_at=now,
            )
            self.session.flush()
            # Every assignment has its own history record, including reassignment
            # without a status transition (which must not fake a status_history row).
            response = AssignmentResponse(
                incident=AssignmentIncident.model_validate(incident),
                history_id=assignment.id,
            )
        return response
