"""Create incidents and their outbox events in one database transaction."""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.automation.publisher import OutboxEventPublisher
from app.automation.schemas import EventType
from app.incidents.models import IdempotencyRecord, Incident
from app.incidents.schemas import IncidentCreateRequest


class IdempotencyKeyConflict(Exception):
    pass


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
    # This transaction lock serializes requests for the same user/key, including
    # the interval before an idempotency row exists.
    lock_bytes = hashlib.sha256(reporter_id.bytes + key.bytes).digest()[:8]
    lock_id = int.from_bytes(lock_bytes, "big", signed=True)

    try:
        db.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": lock_id})
        now = datetime.now(UTC)
        record = db.get(IdempotencyRecord, (reporter_id, key))
        if record is not None and record.expires_at > now:
            if record.request_fingerprint != fingerprint:
                raise IdempotencyKeyConflict
            incident = db.get(Incident, record.incident_id)
            if incident is None:
                raise RuntimeError("Idempotency record refers to a missing incident")
            return incident, False
        if record is not None:
            db.delete(record)
            db.flush()

        incident = Incident(
            reporter_id=reporter_id,
            category=payload.category,
            title=payload.title,
            description=payload.description,
            building=payload.building,
            location_detail=payload.location_detail,
            observed_at=(
                datetime.fromisoformat(payload.observed_at.replace("Z", "+00:00"))
                if payload.observed_at
                else None
            ),
            answers=payload.answers.model_dump(mode="json"),
            reported_at=now,
        )
        db.add(incident)
        db.flush()
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
            EventType.INCIDENT_REPORTED, incident.id, request_id, occurred_at=now
        )
        db.commit()
        return incident, True
    except Exception:
        db.rollback()
        raise
