"""Supplement and incident timeline endpoints."""

import base64
import binascii
import json
from datetime import UTC, datetime
from html import escape
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db
from app.auth.policy import IncidentPolicy, Principal, get_principal
from app.comments.models import Comment
from app.incidents.models import Incident
from app.incidents.router import IncidentRoute, _request_id, error_response
from app.incidents.supplements import IncidentSupplement
from app.models import User
from app.workflow.contracts import WorkflowViolation
from app.workflow.models import Assignment, AuditLog, StatusHistory

router = APIRouter(prefix="/api/v1/incidents", tags=["incidents"], route_class=IncidentRoute)


class SupplementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=2000)
    expected_version: int = Field(strict=True, ge=1)


def _visible_incident(db: Session, principal: Principal, incident_id: UUID) -> Incident:
    incident = db.get(Incident, incident_id, populate_existing=True)
    if incident is None or not IncidentPolicy().can_view(principal, incident):
        raise WorkflowViolation("not_found", 404)
    return incident


def _stamp(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return _stamp(value).isoformat().replace("+00:00", "Z")


def _cursor(item: dict) -> str:
    data = json.dumps([item["created_at"].isoformat(), str(item["id"])], separators=(",", ":"))
    return base64.urlsafe_b64encode(data.encode()).decode().rstrip("=")


def _decode_cursor(value: str) -> tuple[datetime, UUID]:
    try:
        if not value or len(value) > 512:
            raise ValueError
        raw = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        timestamp, item_id = json.loads(raw)
        moment = datetime.fromisoformat(timestamp)
        if moment.tzinfo is None:
            raise ValueError
        return moment.astimezone(UTC), UUID(item_id)
    except (ValueError, TypeError, UnicodeDecodeError, binascii.Error) as exc:
        raise ValueError("Invalid history cursor") from exc


@router.post("/{incident_id}/supplements", status_code=201)
def add_supplement(
    incident_id: UUID,
    payload: SupplementRequest,
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
):
    request_id = _request_id(request)
    try:
        with db.begin_nested():
            incident = _visible_incident(db, principal, incident_id)
            if principal.role != "administrator" and str(incident.reporter_id) != principal.user_id:
                raise WorkflowViolation("forbidden", 403)
            if incident.version != payload.expected_version:
                raise WorkflowViolation("version_conflict", 409)
            if incident.status in {"resolved", "closed"}:
                raise WorkflowViolation("invalid_transition", 409)
            changed = db.execute(
                update(Incident)
                .where(
                    Incident.id == incident_id,
                    Incident.version == payload.expected_version,
                    Incident.status == incident.status,
                )
                .values(version=Incident.version + 1)
                .execution_options(synchronize_session=False)
            )
            if changed.rowcount != 1:
                raise WorkflowViolation("version_conflict", 409)
            supplement = IncidentSupplement(
                id=uuid4(),
                incident_id=incident_id,
                actor_id=UUID(principal.user_id),
                text=payload.text,
                incident_version=payload.expected_version + 1,
                created_at=datetime.now(UTC),
            )
            db.add(supplement)
            db.add(
                AuditLog(
                    incident_id=incident_id,
                    actor_id=UUID(principal.user_id),
                    action="incident.supplemented",
                    request_id=request_id,
                    before={"version": payload.expected_version},
                    after={"version": payload.expected_version + 1},
                )
            )
            db.flush()
        db.commit()
    except Exception:
        db.rollback()
        raise
    response.headers["X-Request-ID"] = str(request_id)
    return {
        "id": supplement.id,
        "created_at": _iso(supplement.created_at),
        "incident_version": supplement.incident_version,
    }


@router.get("/{incident_id}/history")
def get_history(
    incident_id: UUID,
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
):
    incident = _visible_incident(db, principal, incident_id)
    staff = IncidentPolicy().can_operate(principal, incident)
    try:
        boundary = _decode_cursor(cursor) if cursor is not None else None
    except ValueError:
        return error_response(422, "validation_error", "Invalid cursor", _request_id(request))

    # Query only a page from each source. A status change and an assignment may
    # have the same version; they remain two distinct timeline events.
    sources = (IncidentSupplement, Assignment, StatusHistory, Comment)
    records = []
    for model in sources:
        query = select(model).where(model.incident_id == incident_id)
        if model in {StatusHistory, Comment} and not staff:
            query = query.where(model.visibility == "public")
        if boundary is not None:
            query = query.where(
                (model.created_at < boundary[0])
                | ((model.created_at == boundary[0]) & (model.id < boundary[1]))
            )
        records.extend(
            db.scalars(query.order_by(model.created_at.desc(), model.id.desc()).limit(limit + 1))
        )
    people = {
        user.id: user.display_name
        for user in db.scalars(
            select(User).where(
                User.id.in_({record.actor_id for record in records if record.actor_id is not None})
            )
        )
    }
    items = []
    for record in records:
        if isinstance(record, IncidentSupplement):
            action, visibility, details = "incident.supplemented", "public", {"text": record.text}
        elif isinstance(record, Assignment):
            action, visibility = "incident.assigned", "public"
            details = {"department_id": str(record.department_id)} if staff else {}
            if staff:
                details["handler_id"] = str(record.handler_id) if record.handler_id else None
        elif isinstance(record, Comment):
            action, visibility, details = (
                "incident.commented",
                record.visibility,
                {"body": escape(record.body, quote=True)},
            )
        else:
            action, visibility = "incident.status_changed", record.visibility
            details = {"from_status": record.from_status, "to_status": record.to_status}
            if record.resolution and (staff or visibility == "public"):
                details["resolution"] = record.resolution
            if record.reason and staff:
                details["reason"] = record.reason
        items.append(
            {
                "id": record.id,
                "action": action,
                "actor_display_name": people.get(record.actor_id, "Hệ thống"),
                "created_at": _stamp(record.created_at),
                "visibility": visibility,
                "details": details,
            }
        )
    items.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
    # The creation event is stable and visible to every authorized reader.
    created = {
        "id": incident.id,
        "action": "incident.created",
        "actor_display_name": people.get(incident.reporter_id)
        or db.scalar(select(User.display_name).where(User.id == incident.reporter_id))
        or "Hệ thống",
        "created_at": _stamp(incident.reported_at),
        "visibility": "public",
        "details": {},
    }
    if boundary is None or (created["created_at"], created["id"]) < boundary:
        items.append(created)
        items.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
    page = items[:limit]
    response.headers["X-Request-ID"] = str(_request_id(request))
    return {
        "items": [{**item, "created_at": _iso(item["created_at"])} for item in page],
        "next_cursor": _cursor(page[-1]) if len(items) > limit else None,
    }
