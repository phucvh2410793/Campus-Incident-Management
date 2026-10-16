
from datetime import datetime, timedelta, timezone

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

SESSION_DURATION_HOURS = 12


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    department_id: str | None
    is_active: bool


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    db: DBSession = Depends(get_db),
):
    email = str(payload.email).lower()

    user = db.scalar(
        select(User).where(User.email == email)
    )

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
    expires_at = datetime.now(timezone.utc) + timedelta(
        hours=SESSION_DURATION_HOURS
    )

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
    )


@router.get("/me", response_model=UserResponse)
def get_me(
    current_user: User = Depends(get_current_user),
):
    return UserResponse(
        id=str(current_user.id),
        email=current_user.email,
        display_name=current_user.display_name,
        role=current_user.role,
        department_id=(
            str(current_user.department_id)
            if current_user.department_id
            else None
        ),
        is_active=current_user.is_active,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        bearer_scheme
    ),
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
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
    session.revoked_at = datetime.now(timezone.utc)
    db.commit()

    return None
