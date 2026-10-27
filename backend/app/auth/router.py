from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID, uuid4

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from app.auth.dependencies import (
    bearer_scheme,
    get_current_user,
    get_db,
)
from app.auth.models import Session as UserSession
from app.auth.rate_limit import login_limiter
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


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_login_email(cls, value: str) -> str:
        local, separator, domain = value.rpartition("@")
        is_demo_address = bool(separator) and domain.lower() == "demo.invalid"
        # The demo seed uses .invalid, which the email validator normally rejects.
        candidate = f"{local}@demo.example.com" if is_demo_address else value
        try:
            normalized = validate_email(candidate, check_deliverability=False).normalized
        except EmailNotValidError as exc:
            raise ValueError("Invalid email address") from exc
        if is_demo_address:
            return f"{normalized.rpartition('@')[0]}@demo.invalid"
        return normalized


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    department_id: str | None
    is_active: bool


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserResponse


def user_response(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        department_id=str(user.department_id) if user.department_id else None,
        is_active=user.is_active,
    )


def login_request_id(request: Request) -> str:
    supplied = request.headers.get("X-Request-ID")
    try:
        return str(UUID(supplied)) if supplied else str(uuid4())
    except ValueError:
        return str(uuid4())


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


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    db: Annotated[DBSession, Depends(get_db)],
    request: Request,
    response: Response,
) -> LoginResponse | JSONResponse:
    request_id = login_request_id(request)
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


@router.get("/me", response_model=UserResponse)
def get_me(
    current_user: Annotated[User, Depends(get_current_user)],
):
    return user_response(current_user)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
)
def logout(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[DBSession, Depends(get_db)],
):
    # Hash the supplied token before looking up its session.
    token_hash = hash_session_token(credentials.credentials)

    session = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == token_hash,
            UserSession.user_id == current_user.id,
            UserSession.revoked_at.is_(None),
        )
    )

    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session not found or already revoked",
        )

    # Revoke the session so the token cannot be reused.
    session.revoked_at = datetime.now(UTC)
    db.commit()

    return None
