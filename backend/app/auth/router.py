from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from app.auth.dependencies import (
    AuthenticatedSession,
    get_authenticated_session,
    get_current_user,
    get_db,
)
from app.auth.errors import auth_request_id
from app.auth.models import Session as UserSession
from app.auth.rate_limit import login_limiter
from app.auth.schemas import (
    ErrorResponse,
    LoginRequest,
    LoginResponse,
    UserResponse,
)
from app.auth.security import (
    create_session_token,
    hash_session_token,
    verify_password,
)
from app.models import User

router = APIRouter(
    prefix="/api/v1/auth",
    tags=["authentication"],
)

SESSION_DURATION_HOURS = 8


def user_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        department_id=str(user.department_id) if user.department_id else None,
        is_active=user.is_active,
    )


def login_error(
    code: str,
    message: str,
    request_id: str,
    status_code: int,
    extra_headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": [],
                "request_id": request_id,
            }
        },
        headers={"X-Request-ID": request_id, **(extra_headers or {})},
    )


@router.post(
    "/login",
    response_model=LoginResponse,
    responses={
        200: {"model": LoginResponse, "description": "Đăng nhập thành công, trả về Bearer Token"},
        401: {"model": ErrorResponse, "description": "Email hoặc mật khẩu không chính xác"},
        429: {"model": ErrorResponse, "description": "Quá nhiều lần thử sai, bị giới hạn tần suất"},
    },
)
def login(
    payload: LoginRequest,
    db: Annotated[DBSession, Depends(get_db)],
    request: Request,
    response: Response,
) -> LoginResponse | JSONResponse:
    request_id = auth_request_id(request)
    response.headers["X-Request-ID"] = request_id
    email = str(payload.email).lower()
    ip_address = request.client.host if request.client else "unknown"

    retry_after = login_limiter.retry_after(email, ip_address)
    if retry_after is not None:
        return login_error(
            "rate_limited",
            "Quá nhiều lần đăng nhập sai. Hãy thử lại sau.",
            request_id,
            status.HTTP_429_TOO_MANY_REQUESTS,
            {"Retry-After": str(retry_after)},
        )

    user = db.scalar(select(User).where(User.email == email))

    if (
        user is None
        or not user.is_active
        or not verify_password(
            payload.password,
            user.password_hash,
        )
    ):
        login_limiter.record_failure(email, ip_address)
        return login_error(
            "invalid_credentials",
            "Email hoặc mật khẩu không đúng.",
            request_id,
            status.HTTP_401_UNAUTHORIZED,
            {"WWW-Authenticate": "Bearer"},
        )

    login_limiter.clear(email, ip_address)
    token = create_session_token()
    expires_at = datetime.now(UTC) + timedelta(hours=SESSION_DURATION_HOURS)

    session = UserSession(
        user_id=user.id,
        token_hash=hash_session_token(token),
        expires_at=expires_at,
    )

    db.add(session)
    db.commit()

    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        user=user_response(user),
    )


@router.get(
    "/me",
    response_model=UserResponse,
    responses={
        200: {"model": UserResponse, "description": "Thông tin phiên người dùng hiện tại"},
        401: {
            "model": ErrorResponse,
            "description": "Token không hợp lệ, hết hạn hoặc đã bị thu hồi",
        },
    },
)
def get_me(
    current_user: Annotated[User, Depends(get_current_user)],
    request: Request,
    response: Response,
):
    response.headers["X-Request-ID"] = auth_request_id(request)
    return user_response(current_user)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        204: {"description": "Đăng xuất thành công, session token bị thu hồi"},
        401: {
            "model": ErrorResponse,
            "description": "Token không hợp lệ, hết hạn hoặc đã bị thu hồi",
        },
    },
)
def logout(
    auth: Annotated[AuthenticatedSession, Depends(get_authenticated_session)],
    db: Annotated[DBSession, Depends(get_db)],
    request: Request,
    response: Response,
):
    auth.session.revoked_at = datetime.now(UTC)
    db.commit()
    response.headers["X-Request-ID"] = auth_request_id(request)
    return None
