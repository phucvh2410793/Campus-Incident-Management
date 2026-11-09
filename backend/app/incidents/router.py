"""Reporter incident creation API."""

from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.auth.dependencies import get_db
from app.auth.policy import Principal, require_permission
from app.incidents.schemas import IncidentCreateRequest, IncidentResponse, validate_incident_create
from app.incidents.service import IdempotencyKeyConflict, create_incident

router = APIRouter(prefix="/api/v1/incidents", tags=["incidents"])
_create_schema = TypeAdapter(IncidentCreateRequest).json_schema()


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
    try:
        request_id = UUID(request.headers.get("X-Request-ID", ""))
    except ValueError:
        request_id = uuid4()
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
