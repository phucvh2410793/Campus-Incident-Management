
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
