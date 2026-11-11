from dataclasses import dataclass
from typing import Annotated, Protocol

from fastapi import Depends, HTTPException, status

from app.auth.dependencies import get_current_user
from app.incidents.models import Incident
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

    def allows(self, principal: Principal, action: str) -> bool: ...


class RolePolicy:
    """Basic role-based access control policy."""

    permissions = {
        "report_incident": {"reporter", "handler", "department_manager", "administrator"},
        "view_assigned_incidents": {"handler", "department_manager", "administrator"},
        "manage_department": {"administrator"},
        "manage_users": {"administrator"},
        "manage_roles": {"administrator"},
    }

    def allows(self, principal: Principal, action: str) -> bool:
        if principal.role not in ROLES:
            return False

        allowed_roles = self.permissions.get(action, set())
        return principal.role in allowed_roles


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    code: str | None = None
    http_status: int | None = None


class IncidentPolicy:
    """Record-scope policy shared by incident, comment and workflow services."""

    def can_operate(self, principal: Principal, incident: Incident) -> bool:
        if principal.role == "administrator":
            return True
        if principal.department_id is None or principal.department_id != str(
            incident.department_id
        ):
            return False
        if principal.role == "department_manager":
            return True
        return principal.role == "handler" and principal.user_id == str(
            incident.assigned_handler_id
        )

    def can_view(self, principal: Principal, incident: Incident) -> bool:
        if principal.role not in ROLES:
            return False
        return principal.user_id == str(incident.reporter_id) or self.can_operate(
            principal, incident
        )

    def evaluate(self, principal: Principal, incident: Incident, action: str) -> AccessDecision:
        # Check record scope first: a caller outside it must not learn the record exists.
        if not self.can_view(principal, incident):
            return AccessDecision(False, "not_found", 404)
        if action in {"view", "comment_public", "evidence"}:
            return AccessDecision(True)
        if action == "read_internal_comment":
            if self.can_operate(principal, incident):
                return AccessDecision(True)
            return AccessDecision(False, "not_found", 404)
        if action in {"comment_internal", "work"}:
            if self.can_operate(principal, incident):
                return AccessDecision(True)
        elif action == "assign":
            if principal.role == "administrator" or (
                principal.role == "department_manager" and self.can_operate(principal, incident)
            ):
                return AccessDecision(True)
        return AccessDecision(False, "forbidden", 403)


def get_principal(
    current_user: Annotated[User, Depends(get_current_user)],
) -> Principal:
    return Principal(
        user_id=str(current_user.id),
        role=current_user.role,
        department_id=(
            str(current_user.department_id) if current_user.department_id is not None else None
        ),
    )


def require_roles(*allowed_roles: str):
    """Create a dependency that allows only the specified roles."""

    invalid_roles = set(allowed_roles) - ROLES
    if invalid_roles:
        raise ValueError(f"Unknown roles: {sorted(invalid_roles)}")

    def check_role(
        current_user: Annotated[User, Depends(get_current_user)],
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
        principal: Annotated[Principal, Depends(get_principal)],
    ) -> Principal:
        if not policy.allows(principal, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return principal

    return check_permission
