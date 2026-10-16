
from dataclasses import dataclass
from typing import Protocol

from fastapi import Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.models import User


ROLES = {
    "reporter",
    "handler",
    "department_manager",
    "administrator",
}


@dataclass(frozen=True)
class Principal:
    """Represents the authenticated user and their role."""

    user_id: str
    role: str
    department_id: str | None


class Policy(Protocol):
    """Interface for authorization policies."""

    def allows(self, principal: Principal, action: str) -> bool:
        ...


class RolePolicy:
    """Basic role-based access control policy."""

    permissions = {
        "report_incident": {"reporter", "handler", "department_manager", "administrator"},
        "view_assigned_incidents": {"handler", "department_manager", "administrator"},
        "manage_department": {"department_manager", "administrator"},
        "manage_users": {"administrator"},
        "manage_roles": {"administrator"},
    }

    def allows(self, principal: Principal, action: str) -> bool:
        if principal.role not in ROLES:
            return False

        allowed_roles = self.permissions.get(action, set())
        return principal.role in allowed_roles


def get_principal(
    current_user: User = Depends(get_current_user),
) -> Principal:
    return Principal(
        user_id=str(current_user.id),
        role=current_user.role,
        department_id=(
            str(current_user.department_id)
            if current_user.department_id is not None
            else None
        ),
    )


def require_roles(*allowed_roles: str):
    """Create a dependency that allows only the specified roles."""

    invalid_roles = set(allowed_roles) - ROLES
    if invalid_roles:
        raise ValueError(f"Unknown roles: {sorted(invalid_roles)}")

    def check_role(
        current_user: User = Depends(get_current_user),
    ) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource",
            )
        return current_user

    return check_role


def require_permission(action: str):
    """Create a dependency that checks a named permission."""

    policy = RolePolicy()

    def check_permission(
        principal: Principal = Depends(get_principal),
    ) -> Principal:
        if not policy.allows(principal, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return principal

    return check_permission
