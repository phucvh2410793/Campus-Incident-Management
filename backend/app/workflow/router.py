"""Assignment endpoint; local error handling leaves other teams' routes unchanged."""

from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db
from app.auth.policy import Principal, get_principal
from app.workflow.contracts import AssignRequest, WorkflowViolation
from app.workflow.schemas import AssignmentResponse
from app.workflow.service import AssignmentService


def error_response(status: int, code: str, request_id: UUID, details=None, headers=None):
    return JSONResponse(
        status_code=status,
        headers={
            **(headers or {}),
            "X-Request-ID": str(request_id),
        },
        content={
            "error": {
                "code": code,
                "message": code.replace("_", " ").capitalize(),
                "details": details or [],
                "request_id": str(request_id),
            }
        },
    )


class AssignmentRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request: Request):
            try:
                request_id = UUID(request.headers.get("X-Request-ID", ""))
            except ValueError:
                request_id = uuid4()
            request.state.workflow_request_id = request_id
            try:
                response = await original(request)
            except WorkflowViolation as exc:
                return error_response(exc.http_status, exc.code, request_id)
            except RequestValidationError as exc:
                details = [
                    {"field": ".".join(map(str, error["loc"])), "reason": error["type"]}
                    for error in exc.errors()
                ]
                return error_response(422, "validation_error", request_id, details)
            except HTTPException as exc:
                code = "unauthenticated" if exc.status_code == 401 else "forbidden"
                return error_response(exc.status_code, code, request_id, headers=exc.headers)
            except SQLAlchemyError:
                return error_response(503, "service_unavailable", request_id)
            response.headers["X-Request-ID"] = str(request_id)
            return response

        return handle


router = APIRouter(prefix="/api/v1/incidents", tags=["workflow"], route_class=AssignmentRoute)


@router.post("/{incident_id}/assign", response_model=AssignmentResponse)
def assign_incident(
    incident_id: UUID,
    payload: AssignRequest,
    request: Request,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
):
    try:
        result = AssignmentService(db).assign(
            principal,
            incident_id,
            payload,
            request_id=request.state.workflow_request_id,
        )
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
