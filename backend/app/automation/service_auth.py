import hashlib
import hmac
import os
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import Session as UserSession
from app.db import SessionLocal

DEFAULT_DEMO_SERVICE_TOKEN = "cim-service-internal-secret-token-demo"

# Set of known user token hashes for test environments without an active database session
_KNOWN_TEST_USER_TOKEN_HASHES: set[str] = set()


@dataclass(frozen=True)
class ServicePrincipal:
    """Identity representation of an authenticated internal service (e.g. n8n)."""

    service_name: str = "n8n"
    token_hash: str = ""


def hash_service_token(token: str) -> str:
    """Compute constant SHA-256 digest of a service token for secure storage and comparison."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class ServiceTokenManager:
    """Manages active service bearer token hashes with support for secret rotation outside Git.

    Tokens are stored exclusively in hashed format (SHA-256). During rotation, multiple
    token hashes can remain active simultaneously so in-flight requests or transitioning
    services continue to authenticate seamlessly.
    """

    def __init__(self) -> None:
        self._active_hashes: set[str] = set()
        self.reload_from_env()

    def reload_from_env(self) -> None:
        """Load configured service bearer tokens or pre-computed hashes from environment."""
        self._active_hashes.clear()

        # 1. Check raw tokens in environment (comma-separated list)
        env_tokens = os.environ.get("CIM_INTERNAL_SERVICE_BEARER_TOKENS") or os.environ.get(
            "INTERNAL_SERVICE_BEARER_TOKENS"
        )
        if env_tokens:
            for raw_tok in env_tokens.split(","):
                cleaned = raw_tok.strip()
                if cleaned:
                    self._active_hashes.add(hash_service_token(cleaned))

        # 2. Check pre-computed SHA-256 hashes in environment
        env_hashes = os.environ.get("CIM_INTERNAL_SERVICE_TOKEN_HASHES") or os.environ.get(
            "INTERNAL_SERVICE_TOKEN_HASHES"
        )
        if env_hashes:
            for raw_hash in env_hashes.split(","):
                cleaned = raw_hash.strip().lower()
                if cleaned:
                    self._active_hashes.add(cleaned)

        # 3. Development / demo default if no tokens configured
        if not self._active_hashes:
            self._active_hashes.add(hash_service_token(DEFAULT_DEMO_SERVICE_TOKEN))

    def get_active_hashes(self) -> set[str]:
        return set(self._active_hashes)

    def register_service_token(self, token: str) -> str:
        """Register a new service token, adding its hash to the active rotation set."""
        h = hash_service_token(token.strip())
        self._active_hashes.add(h)
        return h

    def register_token_hash(self, token_hash: str) -> None:
        """Register a pre-computed token hash into active rotation set."""
        self._active_hashes.add(token_hash.strip().lower())

    def revoke_token_hash(self, token_hash: str) -> bool:
        """Revoke a token hash from the active set."""
        cleaned = token_hash.strip().lower()
        if cleaned in self._active_hashes:
            self._active_hashes.remove(cleaned)
            return True
        return False

    def is_valid_service_token(self, token: str) -> bool:
        """Validate token by hashing and checking against active hashes in constant time."""
        if not token:
            return False
        incoming_hash = hash_service_token(token)
        for valid_hash in self._active_hashes:
            if hmac.compare_digest(incoming_hash, valid_hash):
                return True
        return False

    def reset(self) -> None:
        """Reset token manager to original environment state."""
        self.reload_from_env()


# Global singleton instance
token_manager = ServiceTokenManager()


def register_test_user_token(token: str) -> str:
    """Register a user token in-memory for testing user token rejection without DB."""
    h = hash_service_token(token.strip())
    _KNOWN_TEST_USER_TOKEN_HASHES.add(h)
    return h


def clear_test_user_tokens() -> None:
    _KNOWN_TEST_USER_TOKEN_HASHES.clear()


def is_user_token(token: str, db: Session | None = None) -> bool:
    """Determine whether the presented bearer token belongs to a regular user session.

    Per CIM architecture and security policy:
    User tokens MUST NOT be permitted to access internal service endpoints (/internal/*).
    """
    if not token:
        return False

    token_hash = hash_service_token(token)

    # 1. Check in-memory test registry
    if token_hash in _KNOWN_TEST_USER_TOKEN_HASHES:
        return True

    # 2. Check active database sessions if db is available
    if db is not None:
        try:
            stmt = select(UserSession.id).where(UserSession.token_hash == token_hash)
            existing_user_session = db.scalar(stmt)
            if existing_user_session is not None:
                return True
        except Exception:
            pass

    return False


service_bearer_scheme = HTTPBearer(auto_error=False)


def get_optional_db():
    """Yield a database session if database connection is available, else None."""
    try:
        db = SessionLocal()
    except Exception:
        yield None
        return

    try:
        yield db
    finally:
        db.close()


def require_service_bearer(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(service_bearer_scheme)],
    db: Annotated[Session | None, Depends(get_optional_db)] = None,
) -> ServicePrincipal:
    """FastAPI dependency enforcing service bearer authentication for /internal/* endpoints.

    Rules enforced:
    1. Authorization header must be present and use 'Bearer' scheme (401).
    2. User tokens are strictly rejected (403 Forbidden with descriptive detail).
    3. Service token must match an active hash in the rotation set (401).
    4. Successful verification returns a ServicePrincipal representing n8n service identity.
    """
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Service bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    raw_token = credentials.credentials
    if not raw_token or not raw_token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Service bearer token cannot be empty",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Reject user tokens
    if is_user_token(raw_token, db=db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User tokens are not permitted to access internal endpoints",
        )

    # Verify against active service token hashes
    if not token_manager.is_valid_service_token(raw_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired service bearer token",
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        )

    return ServicePrincipal(
        service_name="n8n",
        token_hash=hash_service_token(raw_token),
    )
