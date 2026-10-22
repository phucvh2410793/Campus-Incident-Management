from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from app.auth.dependencies import (
    bearer_scheme,
    get_current_user,
    get_db,
)
from app.auth.models import Session as UserSession
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
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


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


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    db: Annotated[DBSession, Depends(get_db)],
):
    email = str(payload.email).lower()

    user = db.scalar(select(User).where(User.email == email))

    if (
        user is None
        or not user.is_active
        or not verify_password(
            payload.password,
            user.password_hash,
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

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
