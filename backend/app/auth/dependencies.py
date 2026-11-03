from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, update
from sqlalchemy.orm import Session as DBSession

from app.auth.errors import UnauthenticatedError
from app.auth.models import Session as UserSession
from app.auth.security import hash_session_token
from app.db import SessionLocal
from app.models import User

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthenticatedSession:
    user: User
    session: UserSession


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def revoke_user_sessions(db: DBSession, user_id: UUID) -> None:
    """Revoke all tokens when a user is locked; W6 admin actions can call this too."""
    db.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


def lock_user(db: DBSession, user: User) -> None:
    """Lock a user and revoke all sessions in the caller's transaction."""
    user.is_active = False
    db.flush()
    revoke_user_sessions(db, user.id)


def get_authenticated_session(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[DBSession, Depends(get_db)],
) -> AuthenticatedSession:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UnauthenticatedError()

    token_hash = hash_session_token(credentials.credentials)
    session = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == token_hash,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(UTC),
        )
    )

    if session is None:
        raise UnauthenticatedError()

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        if user is not None:
            revoke_user_sessions(db, user.id)
            db.commit()
        raise UnauthenticatedError()

    return AuthenticatedSession(user=user, session=session)


def get_current_user(
    auth: Annotated[AuthenticatedSession, Depends(get_authenticated_session)],
) -> User:
    return auth.user
