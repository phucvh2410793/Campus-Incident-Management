"""Incident creation and scoped read APIs."""

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth.dependencies import get_db
from app.auth.policy import Principal, get_principal, require_permission
from app.incidents.models import Incident
from app.incidents.schemas import (
    IncidentCreateRequest,
    IncidentPage,
    IncidentResponse,
    IncidentSummary,
    validate_incident_create,
)
from app.incidents.service import (
    IdempotencyKeyConflict,
    create_incident,
    list_incidents,
    visible_incidents,
)


class IncidentRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await original(request)
            except RequestValidationError as exc:
                details = [
                    {"field": ".".join(map(str, error["loc"])), "reason": error["type"]}
                    for error in exc.errors()
                ]
                return error_response(
                    422, "validation_error", "Invalid request", _request_id(request), details
                )

        return handle


router = APIRouter(prefix="/api/v1/incidents", tags=["incidents"], route_class=IncidentRoute)
_create_schema = TypeAdapter(IncidentCreateRequest).json_schema()


def _request_id(request: Request) -> UUID:
    try:
        return UUID(request.headers.get("X-Request-ID", ""))
    except ValueError:
        return uuid4()


def error_response(status_code: int, code: str, message: str, request_id: UUID, details=None):
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or [],
                "request_id": str(request_id),
            }
        },
        headers={"X-Request-ID": str(request_id)},
    )


@router.post(
    "",
    response_model=IncidentResponse,
    status_code=201,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": _create_schema}},
        },
        "parameters": [
            {
                "name": "Idempotency-Key",
                "in": "header",
                "required": True,
                "schema": {"type": "string", "format": "uuid"},
            }
        ],
    },
)
async def post_incident(
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(require_permission("report_incident"))],
    db: Annotated[Session, Depends(get_db)],
):
    request_id = _request_id(request)
    key_text = request.headers.get("Idempotency-Key")
    if not key_text:
        return error_response(
            400, "missing_idempotency_key", "Idempotency-Key is required", request_id
        )
    try:
        idempotency_key = UUID(key_text)
    except ValueError:
        return error_response(400, "bad_request", "Idempotency-Key must be a UUID", request_id)
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
        return error_response(415, "unsupported_media_type", "JSON body required", request_id)
    try:
        payload = validate_incident_create(await request.json())
    except ValidationError as exc:
        details = [
            {"field": ".".join(str(part) for part in error["loc"]), "reason": error["type"]}
            for error in exc.errors()
        ]
        return error_response(422, "validation_error", "Invalid incident data", request_id, details)
    except ValueError:
        return error_response(400, "bad_request", "Malformed JSON body", request_id)
    try:
        incident, created = await run_in_threadpool(
            create_incident, db, UUID(principal.user_id), idempotency_key, payload, request_id
        )
    except IdempotencyKeyConflict:
        return error_response(
            409, "idempotency_conflict", "Idempotency-Key was used with another body", request_id
        )
    response.status_code = 201 if created else 200
    response.headers["X-Request-ID"] = str(request_id)
    response.headers["Location"] = f"/api/v1/incidents/{incident.id}"
    return IncidentResponse.model_validate(incident)


@router.get("", response_model=IncidentPage)
def get_incidents(
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
    status: Literal["reported", "assigned", "in_progress", "resolved", "closed"] | None = None,
    category: Literal["water_leak", "electrical_hazard", "phishing"] | None = None,
    priority: Literal["p1", "p2", "p3"] | None = None,
    department_id: UUID | None = None,
    triage_required: bool | None = None,
    overdue: bool | None = None,
):
    now = datetime.now(UTC)
    try:
        incidents, next_cursor = list_incidents(
            db,
            principal,
            limit=limit,
            cursor=cursor,
            status=status,
            category=category,
            priority=priority,
            department_id=department_id,
            triage_required=triage_required,
            overdue=overdue,
            now=now,
        )
    except ValueError:
        return error_response(422, "validation_error", "Invalid cursor", _request_id(request))
    response.headers["X-Request-ID"] = str(_request_id(request))
    items = [
        IncidentSummary.model_validate(incident).model_copy(
            update={
                "overdue": bool(
                    incident.acknowledgment_deadline_at
                    and incident.acknowledged_at is None
                    and incident.acknowledgment_deadline_at < now
                )
            }
        )
        for incident in incidents
    ]
    return IncidentPage(items=items, next_cursor=next_cursor)


@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident(
    incident_id: UUID,
    request: Request,
    response: Response,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
):
    incident = db.scalar(
        select(Incident).where(Incident.id == incident_id, visible_incidents(principal))
    )
    if incident is None:
        return error_response(404, "not_found", "Incident not found", _request_id(request))
    response.headers["X-Request-ID"] = str(_request_id(request))
    result = IncidentResponse.model_validate(incident)
    staff_scope = (
        principal.role == "administrator"
        or principal.role == "handler"
        and str(incident.assigned_handler_id) == principal.user_id
        or principal.role == "department_manager"
        and str(incident.department_id) == principal.department_id
    )
    return result if staff_scope else result.model_copy(update={"assigned_handler_id": None})
