"""HTTP adapter for the existing comment service and shared incident policy."""

from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db
from app.auth.policy import Principal, get_principal
from app.comments.contracts import CommentRequest
from app.comments.service import CommentService
from app.workflow.contracts import WorkflowViolation


class CommentResponse(BaseModel):
    id: UUID
    incident_id: UUID
    actor_id: UUID
    body: str
    visibility: Literal["public", "internal"]
    created_at: str
    incident_version: int | None = None


class CommentPage(BaseModel):
    items: list[CommentResponse]
    next_cursor: str | None


def error_response(request: Request, status_code: int, code: str, details=None) -> JSONResponse:
    request_id = request.state.comment_request_id
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": code.replace("_", " ").capitalize(),
                "details": details or [],
                "request_id": str(request_id),
            }
        },
        headers={"X-Request-ID": str(request_id)},
    )


class CommentRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request: Request):
            try:
                request_id = UUID(request.headers.get("X-Request-ID", ""))
            except ValueError:
                request_id = uuid4()
            request.state.comment_request_id = request_id
            try:
                response = await original(request)
            except WorkflowViolation as exc:
                return error_response(request, exc.http_status, exc.code)
            except RequestValidationError as exc:
                details = [
                    {"field": ".".join(map(str, error["loc"])), "reason": error["type"]}
                    for error in exc.errors()
                ]
                return error_response(request, 422, "validation_error", details)
            except HTTPException as exc:
                code = "unauthenticated" if exc.status_code == 401 else "forbidden"
                return error_response(request, exc.status_code, code)
            except SQLAlchemyError:
                return error_response(request, 503, "service_unavailable")
            response.headers["X-Request-ID"] = str(request_id)
            return response

        return handle


router = APIRouter(prefix="/api/v1/incidents", tags=["comments"], route_class=CommentRoute)


@router.get("/{incident_id}/comments", response_model=CommentPage, response_model_exclude_none=True)
def list_comments(
    incident_id: UUID,
    request: Request,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
):
    try:
        return CommentService(db).list_page(principal, incident_id, limit=limit, cursor=cursor)
    except WorkflowViolation:
        raise
    except ValueError:
        return error_response(request, 422, "validation_error")


@router.post("/{incident_id}/comments", response_model=CommentResponse, status_code=201)
def create_comment(
    incident_id: UUID,
    payload: CommentRequest,
    request: Request,
    principal: Annotated[Principal, Depends(get_principal)],
    db: Annotated[Session, Depends(get_db)],
):
    try:
        result = CommentService(db).create(
            principal,
            incident_id,
            payload,
            request_id=request.state.comment_request_id,
        )
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
