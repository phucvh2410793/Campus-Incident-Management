
"""Create incidents and read them within the caller's record scope."""

import base64
import binascii
import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, select, text, tuple_
from sqlalchemy.orm import Session

from app.sla.policy import calculate_deadline
from app.auth.policy import IncidentPolicy, Principal
from app.automation.publisher import OutboxEventPublisher
from app.automation.schemas import EventType
from app.incidents.models import IdempotencyRecord, Incident
from app.incidents.schemas import IncidentCreateRequest
from app.models import Department
from app.rules.engine import evaluate_incident
from app.rules.models import RuleEvaluation, RuleVersion
from app.incidents.schemas import ManualTriageRequest
from app.workflow.contracts import WorkflowViolation
from app.workflow.models import AuditLog
from app.workflow.repository import WorkflowRepository
from app.rules.engine import MANUAL_QUEUE
from app.rules.engine import evaluate_rule_version

class IdempotencyKeyConflict(Exception):
    pass


def visible_incidents(principal: Principal):
    """Use the shared incident policy before filtering or pagination."""
    return IncidentPolicy().visible_clause(principal)


def encode_cursor(incident: Incident) -> str:
    payload = json.dumps(
        [incident.reported_at.isoformat(), str(incident.id)], separators=(",", ":")
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        if len(cursor) > 512 or not cursor:
            raise ValueError
        data = base64.b64decode(
            cursor + "=" * (-len(cursor) % 4),
            altchars=b"-_",
            validate=True,
        )
        timestamp, incident_id = json.loads(data)
        timestamp = datetime.fromisoformat(timestamp)
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise ValueError
        return timestamp, UUID(incident_id)
    except (ValueError, TypeError, UnicodeDecodeError, binascii.Error) as exc:
        raise ValueError("Invalid cursor") from exc


def overdue_condition(now: datetime):
    return and_(
        Incident.acknowledgment_deadline_at.is_not(None),
        Incident.acknowledged_at.is_(None),
        Incident.acknowledgment_deadline_at < now,
    )


def list_incidents(
    db: Session,
    principal: Principal,
    *,
    limit: int,
    cursor: str | None,
    status: str | None,
    category: str | None,
    priority: str | None,
    department_id: UUID | None,
    triage_required: bool | None,
    overdue: bool | None,
    now: datetime,
) -> tuple[list[Incident], str | None]:
    query = select(Incident).where(visible_incidents(principal))

    for column, value in (
        (Incident.status, status),
        (Incident.category, category),
        (Incident.priority, priority),
        (Incident.department_id, department_id),
        (Incident.triage_required, triage_required),
    ):
        if value is not None:
            query = query.where(column == value)

    if overdue is not None:
        condition = overdue_condition(now)
        query = query.where(condition if overdue else ~condition)

    if cursor is not None:
        query = query.where(
            tuple_(Incident.reported_at, Incident.id)
            < tuple_(*decode_cursor(cursor))
        )

    rows = db.scalars(
        query.order_by(
            Incident.reported_at.desc(),
            Incident.id.desc(),
        ).limit(limit + 1)
    ).all()

    return (
        rows[:limit],
        encode_cursor(rows[limit - 1]) if len(rows) > limit else None,
    )


def create_incident(
    db: Session,
    reporter_id: UUID,
    key: UUID,
    payload: IncidentCreateRequest,
    request_id: UUID,
) -> tuple[Incident, bool]:
    body = payload.model_dump(mode="json")
    fingerprint = hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    lock_bytes = hashlib.sha256(reporter_id.bytes + key.bytes).digest()[:8]
    lock_id = int.from_bytes(lock_bytes, "big", signed=True)

    try:
        db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_id)"),
            {"lock_id": lock_id},
        )
        now = datetime.now(UTC)

        # Preserve idempotency: do not evaluate or save history twice.
        record = db.get(IdempotencyRecord, (reporter_id, key))

        if record is not None and record.expires_at > now:
            if record.request_fingerprint != fingerprint:
                raise IdempotencyKeyConflict

            incident = db.get(Incident, record.incident_id)
            if incident is None:
                raise RuntimeError(
                    "Idempotency record refers to a missing incident"
                )

            return incident, False

        if record is not None:
            db.delete(record)
            db.flush()

        # Evaluate the incident exactly once.
        answers = payload.answers.model_dump(mode="json")
        result = evaluate_incident(payload.category, answers)

        # Find the stored rule version.
        rule_version = db.scalar(
            select(RuleVersion).where(
                RuleVersion.version == result.rule_version,
                RuleVersion.is_active.is_(True),
            )
        )

        if rule_version is None:
            raise RuntimeError(
                f"Active rule version not found: {result.rule_version}"
            )

        # Find the department selected by the rule engine.
        department = db.scalar(
            select(Department).where(
                Department.name == result.department
            )
        )

        if department is None:
            raise RuntimeError(
                f"Department not found: {result.department}. "
                "Run the demo seed before creating incidents."
            )

        evaluation_data = result.model_dump(mode="json")
        incident = Incident(
            reporter_id=reporter_id,
            category=payload.category,
            title=payload.title,
            description=payload.description,
            building=payload.building,
            location_detail=payload.location_detail,
            observed_at=(
                datetime.fromisoformat(
                    payload.observed_at.replace("Z", "+00:00")
                )
                if payload.observed_at
                else None
            ),
            answers=answers,
            reported_at=now,
            severity=result.severity,
            priority=result.priority,
            acknowledgment_deadline_at=(
                calculate_deadline(now, result.priority)
                if result.priority is not None
                else None
            ),
            department_id=department.id,
            triage_required=result.triage_required,
            rule_evaluation=evaluation_data,
        )

        db.add(incident)
        db.flush()

        # Save the initial rule evaluation for W9 history.
        db.add(
            RuleEvaluation(
                incident_id=incident.id,
                rule_version_id=rule_version.id,
                rule_id=result.rule_id,
                severity=result.severity,
                priority=result.priority,
                department=result.department,
                reason=result.reason,
                triage_required=result.triage_required,
                safety_flags=list(result.safety_flags),
            )
        )

        db.add(
            IdempotencyRecord(
                user_id=reporter_id,
                key=key,
                request_fingerprint=fingerprint,
                incident_id=incident.id,
                created_at=now,
                expires_at=now + timedelta(hours=24),
            )
        )

        OutboxEventPublisher(db).create_and_publish(
            EventType.INCIDENT_REPORTED,
            incident.id,
            request_id,
            occurred_at=now,
        )

        db.commit()
        return incident, True

    except Exception:
        db.rollback()
        raise

def get_rule_evaluation_history(db, principal, incident_id):
    incident = db.scalar(
        select(Incident).where(
            Incident.id == incident_id,
            visible_incidents(principal),
        )
    )

    if incident is None:
        raise WorkflowViolation("not_found", 404)

    return db.scalars(
        select(RuleEvaluation)
        .where(RuleEvaluation.incident_id == incident_id)
        .order_by(
            RuleEvaluation.evaluated_at.asc(),
            RuleEvaluation.id.asc(),
        )
    ).all()

def manual_triage(
    db,
    principal,
    incident_id,
    payload: ManualTriageRequest,
    request_id,
):
    with db.begin_nested():
        incident = db.get(
            Incident,
            incident_id,
            populate_existing=True,
            with_for_update=True,
        )

        if incident is None:
            raise WorkflowViolation("not_found", 404)

        decision = IncidentPolicy().evaluate(principal, incident, "work")
        if not decision.allowed:
            raise WorkflowViolation(decision.code, decision.http_status)

        if incident.version != payload.expected_version:
            raise WorkflowViolation("version_conflict", 409)

        if incident.status in {"resolved", "closed"}:
            raise WorkflowViolation("invalid_transition", 409)

        department = db.scalar(
            select(Department)
            .where(Department.id == payload.department_id)
            .with_for_update(read=True)
        )

        if department is None or department.name.casefold() in {
            "triage_queue",
            MANUAL_QUEUE.casefold(),
        }:
            raise WorkflowViolation("validation_error", 422)

        # Preserve the rule version associated with the existing evaluation.
        current_evaluation = incident.rule_evaluation or {}
        version_name = current_evaluation.get("rule_version", "demo-v1")

        rule_version = db.scalar(
            select(RuleVersion).where(RuleVersion.version == version_name)
        )

        if rule_version is None:
            raise WorkflowViolation("rule_version_not_found", 409)

        now = datetime.now(UTC)
        actor_id = UUID(principal.user_id)

        old_department_id = incident.department_id

        before = {
            "department_id": str(old_department_id) if old_department_id else None,
            "severity": incident.severity,
            "priority": incident.priority,
            "triage_required": incident.triage_required,
            "version": incident.version,
        }

        result = db.execute(
            update(Incident)
            .where(
                Incident.id == incident_id,
                Incident.version == payload.expected_version,
            )
            .values(
                department_id=department.id,
                assigned_handler_id=(
                    None
                    if old_department_id != department.id
                    else incident.assigned_handler_id
                ),
                severity=payload.severity,
                priority=payload.priority,
                acknowledgment_deadline_at=calculate_deadline(
                    incident.reported_at,
                    payload.priority,
                ),
                triage_required=False,
                rule_evaluation={
                    "rule_id": None,
                    "rule_version": version_name,
                    "severity": payload.severity,
                    "priority": payload.priority,
                    "department": department.name,
                    "reason": payload.reason,
                    "triage_required": False,
                    "safety_flags": [],
                    "manual": True,
                },
                version=Incident.version + 1,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )

        if result.rowcount != 1:
            raise WorkflowViolation("version_conflict", 409)

        db.add(
            RuleEvaluation(
                incident_id=incident_id,
                rule_version_id=rule_version.id,
                rule_id=None,
                severity=payload.severity,
                priority=payload.priority,
                department=department.name,
                reason=f"Manual triage: {payload.reason}",
                triage_required=False,
                safety_flags=[],
            )
        )

        db.flush()
        db.refresh(incident)

        after = {
            "department_id": str(incident.department_id),
            "severity": incident.severity,
            "priority": incident.priority,
            "triage_required": incident.triage_required,
            "version": incident.version,
            "reason": payload.reason,
            "manual": True,
        }

        WorkflowRepository(db).add_audit(
            AuditLog(
                incident_id=incident_id,
                actor_id=actor_id,
                action="incident.manual_triage",
                request_id=request_id,
                created_at=now,
                before=before,
                after=after,
            )
        )

        db.flush()

    return incident

def reevaluate_incident(
    db,
    principal,
    incident_id,
    expected_version,
    request_id,
):
    if principal.role != "administrator":
        raise WorkflowViolation("forbidden", 403)

    with db.begin_nested():
        incident = db.get(
            Incident,
            incident_id,
            populate_existing=True,
            with_for_update=True,
        )

        if incident is None:
            raise WorkflowViolation("not_found", 404)

        if incident.version != expected_version:
            raise WorkflowViolation("version_conflict", 409)

        if incident.status in {"resolved", "closed"}:
            raise WorkflowViolation("invalid_transition", 409)

        rule_version = db.scalar(
            select(RuleVersion)
            .where(RuleVersion.is_active.is_(True))
            .order_by(RuleVersion.created_at.desc())
            .limit(1)
        )

        if rule_version is None:
            raise WorkflowViolation("rule_version_not_found", 409)

        result = evaluate_rule_version(
            incident.category,
            incident.answers or {},
            rule_version,
        )

        department = db.scalar(
            select(Department).where(
                Department.name == result.department
            )
        )

        if department is None:
            raise WorkflowViolation("department_not_found", 409)

        now = datetime.now(UTC)
        actor_id = UUID(principal.user_id)

        old_department_id = incident.department_id
        new_department_id = department.id

        before = {
            "department_id": str(old_department_id) if old_department_id else None,
            "severity": incident.severity,
            "priority": incident.priority,
            "triage_required": incident.triage_required,
            "rule_evaluation": incident.rule_evaluation,
            "version": incident.version,
        }

        changed_department = old_department_id != new_department_id

        update_result = db.execute(
            update(Incident)
            .where(
                Incident.id == incident_id,
                Incident.version == expected_version,
            )
            .values(
                department_id=new_department_id,
                assigned_handler_id=(
                    None if changed_department else incident.assigned_handler_id
                ),
                severity=result.severity,
                priority=result.priority,
                acknowledgment_deadline_at=(
                    calculate_deadline(incident.reported_at, result.priority)
                    if result.priority is not None
                    else None
                ),
                triage_required=result.triage_required,
                rule_evaluation=result.model_dump(),
                version=Incident.version + 1,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )

        if update_result.rowcount != 1:
            raise WorkflowViolation("version_conflict", 409)

        db.add(
            RuleEvaluation(
                incident_id=incident_id,
                rule_version_id=rule_version.id,
                rule_id=result.rule_id,
                severity=result.severity,
                priority=result.priority,
                department=result.department,
                reason=result.reason,
                triage_required=result.triage_required,
                safety_flags=list(result.safety_flags),
            )
        )

        db.flush()
        db.refresh(incident)

        after = {
            "department_id": str(incident.department_id),
            "severity": incident.severity,
            "priority": incident.priority,
            "triage_required": incident.triage_required,
            "rule_evaluation": incident.rule_evaluation,
            "version": incident.version,
            "department_changed": changed_department,
        }

        WorkflowRepository(db).add_audit(
            AuditLog(
                incident_id=incident_id,
                actor_id=actor_id,
                action="incident.rule_re_evaluated",
                request_id=request_id,
                created_at=now,
                before=before,
                after=after,
            )
        )

        db.flush()

    return incident