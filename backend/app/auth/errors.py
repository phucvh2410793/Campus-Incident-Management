"""Shared error response for user bearer authentication."""

from uuid import UUID, uuid4

from fastapi import Request
from fastapi.responses import JSONResponse


class UnauthenticatedError(Exception):
    """The supplied user session cannot authenticate this request."""


def auth_request_id(request: Request) -> str:
    supplied = request.headers.get("X-Request-ID")
    try:
        return str(UUID(supplied)) if supplied else str(uuid4())
    except ValueError:
        return str(uuid4())


def unauthenticated_response(request: Request, _exc: UnauthenticatedError) -> JSONResponse:
    request_id = auth_request_id(request)
    return JSONResponse(
        status_code=401,
        content={
            "error": {
                "code": "unauthenticated",
                "message": "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",
                "details": [],
                "request_id": request_id,
            }
        },
        headers={"WWW-Authenticate": "Bearer", "X-Request-ID": request_id},
    )
