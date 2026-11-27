"""Small administrator API for demo identities, departments and rule versions."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin.models import AdminAuditLog
from app.admin.schemas import (
    DepartmentCreate,
    DepartmentSummary,
    Role,
    RuleVersionCreate,
    RuleVersionSummary,
    UserCreate,
    UserPage,
    UserPatch,
    UserSummary,
)
from app.auth.dependencies import get_db, lock_user, revoke_user_sessions
from app.auth.errors import auth_request_id
from app.auth.policy import require_roles
from app.auth.security import hash_password
from app.models import Department, User
from app.rules.models import RuleVersion


def admin_error(request: Request, status_code: int, code: str, details=None) -> JSONResponse:
    request_id = request.state.admin_request_id
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": code.replace("_", " ").capitalize(),
                "details": details or [],
                "request_id": request_id,
            }
        },
        headers={"X-Request-ID": request_id},
    )


class AdminRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request: Request):
            request.state.admin_request_id = auth_request_id(request)
            try:
                response = await original(request)
            except RequestValidationError as exc:
                details = [
                    {"field": ".".join(map(str, error["loc"])), "reason": error["type"]}
                    for error in exc.errors()
                ]
                return admin_error(request, 422, "validation_error", details)
            except HTTPException as exc:
                code = "forbidden" if exc.status_code == 403 else "not_found"
                return admin_error(request, exc.status_code, code)
            response.headers["X-Request-ID"] = request.state.admin_request_id
            return response

        return handle


router = APIRouter(prefix="/api/v1/admin", tags=["administration"], route_class=AdminRoute)
Administrator = Annotated[User, Depends(require_roles("administrator"))]
Database = Annotated[Session, Depends(get_db)]


def user_snapshot(user: User) -> dict:
    """Never put a password hash or session token into audit data."""
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
        "department_id": str(user.department_id) if user.department_id else None,
        "is_active": user.is_active,
    }


def record_audit(
    db: Session,
    request: Request,
    actor: User,
    action: str,
    target_type: str,
    target_id: UUID,
    before: dict,
    after: dict,
) -> None:
    db.add(
        AdminAuditLog(
            actor_id=actor.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            request_id=UUID(request.state.admin_request_id),
            before=before,
            after=after,
        )
    )


def commit_or_conflict(db: Session, request: Request):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return admin_error(request, 409, "conflict")
    return None


def department_problem(db: Session, role: str, department_id: UUID | None) -> bool:
    if role in {"handler", "department_manager"} and department_id is None:
        return True
    return department_id is not None and db.get(Department, department_id) is None


@router.get("/users", response_model=UserPage)
def list_users(
    actor: Administrator,
    db: Database,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: UUID | None = None,
    role: Role | None = None,
    department_id: UUID | None = None,
    is_active: bool | None = None,
):
    statement = select(User)
    if cursor is not None:
        statement = statement.where(User.id > cursor)
    if role is not None:
        statement = statement.where(User.role == role)
    if department_id is not None:
        statement = statement.where(User.department_id == department_id)
    if is_active is not None:
        statement = statement.where(User.is_active == is_active)
    users = db.scalars(statement.order_by(User.id).limit(limit + 1)).all()
    return UserPage(
        items=[UserSummary.model_validate(user) for user in users[:limit]],
        next_cursor=users[limit - 1].id if len(users) > limit else None,
    )


@router.post("/users", response_model=UserSummary, status_code=201)
def create_user(payload: UserCreate, request: Request, actor: Administrator, db: Database):
    if department_problem(db, payload.role, payload.department_id):
        return admin_error(request, 422, "invalid_department")
    if db.scalar(select(User.id).where(func.lower(User.email) == payload.email.lower())):
        return admin_error(request, 409, "email_conflict")
    user = User(
        email=payload.email,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        department_id=payload.department_id,
        is_active=True,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return admin_error(request, 409, "email_conflict")
    record_audit(db, request, actor, "user.created", "user", user.id, {}, user_snapshot(user))
    error = commit_or_conflict(db, request)
    return error or UserSummary.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserSummary)
def update_user(
    user_id: UUID, payload: UserPatch, request: Request, actor: Administrator, db: Database
):
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        return admin_error(request, 404, "not_found")
    role = payload.role if "role" in payload.model_fields_set else user.role
    department_id = (
        payload.department_id if "department_id" in payload.model_fields_set else user.department_id
    )
    if department_problem(db, role, department_id):
        return admin_error(request, 422, "invalid_department")
    if user.id == actor.id and (
        ("is_active" in payload.model_fields_set and payload.is_active is False)
        or role != "administrator"
    ):
        return admin_error(request, 409, "cannot_demote_self")

    before = user_snapshot(user)
    role_or_department_changed = role != user.role or department_id != user.department_id
    user.role = role
    user.department_id = department_id
    if "is_active" in payload.model_fields_set:
        if payload.is_active is False:
            lock_user(db, user)
        else:
            user.is_active = True
    if role_or_department_changed:
        revoke_user_sessions(db, user.id)
    after = user_snapshot(user)
    if before != after:
        record_audit(db, request, actor, "user.updated", "user", user.id, before, after)
    error = commit_or_conflict(db, request)
    return error or UserSummary.model_validate(user)


@router.get("/departments", response_model=list[DepartmentSummary])
def list_departments(actor: Administrator, db: Database):
    return [
        DepartmentSummary.model_validate(item)
        for item in db.scalars(select(Department).order_by(Department.name, Department.id)).all()
    ]


@router.post("/departments", response_model=DepartmentSummary, status_code=201)
def create_department(
    payload: DepartmentCreate, request: Request, actor: Administrator, db: Database
):
    if db.scalar(select(Department.id).where(func.lower(Department.name) == payload.name.lower())):
        return admin_error(request, 409, "department_conflict")
    department = Department(name=payload.name)
    db.add(department)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return admin_error(request, 409, "department_conflict")
    record_audit(
        db,
        request,
        actor,
        "department.created",
        "department",
        department.id,
        {},
        {"id": str(department.id), "name": department.name},
    )
    error = commit_or_conflict(db, request)
    return error or DepartmentSummary.model_validate(department)


@router.get("/rules", response_model=list[RuleVersionSummary])
def list_rules(actor: Administrator, db: Database):
    return [
        RuleVersionSummary.model_validate(item)
        for item in db.scalars(
            select(RuleVersion).order_by(RuleVersion.created_at.desc(), RuleVersion.id.desc())
        ).all()
    ]


@router.post("/rules/versions", response_model=RuleVersionSummary, status_code=201)
def create_rule_version(
    payload: RuleVersionCreate, request: Request, actor: Administrator, db: Database
):
    if db.scalar(select(RuleVersion.id).where(RuleVersion.version == payload.version)):
        return admin_error(request, 409, "version_conflict")
    departments = {name.casefold() for name in db.scalars(select(Department.name)).all()}
    if any(rule.department.casefold() not in departments for rule in payload.rules):
        return admin_error(request, 422, "invalid_department")
    # New definitions are stored for review. N3's current evaluator is still code-based.
    version = RuleVersion(
        version=payload.version,
        rules=[rule.model_dump(mode="json", exclude_defaults=True) for rule in payload.rules],
        is_active=False,
    )
    db.add(version)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return admin_error(request, 409, "version_conflict")
    record_audit(
        db,
        request,
        actor,
        "rule_version.created",
        "rule_version",
        version.id,
        {},
        {
            "id": str(version.id),
            "version": version.version,
            "rule_count": len(version.rules),
            "is_active": False,
        },
    )
    error = commit_or_conflict(db, request)
    return error or RuleVersionSummary.model_validate(version)

@router.post(
    "/rules/versions/{version_id}/activate",
    response_model=RuleVersionSummary,
)
def activate_rule_version(
    version_id: UUID,
    request: Request,
    actor: Administrator,
    db: Database,
):
    # Lock rule versions to prevent concurrent activation changes.
    versions = db.scalars(
        select(RuleVersion)
        .order_by(RuleVersion.id)
        .with_for_update()
    ).all()

    target = next(
        (item for item in versions if item.id == version_id),
        None,
    )

    if target is None:
        return admin_error(request, 404, "rule_version_not_found")

    before = {
        "active_versions": [
            str(item.id) for item in versions if item.is_active
        ]
    }

    # Only one rule version should be active.
    for item in versions:
        item.is_active = item.id == version_id

    record_audit(
        db,
        request,
        actor,
        "rule_version.activated",
        "rule_version",
        target.id,
        before,
        {
            "id": str(target.id),
            "version": target.version,
            "is_active": True,
        },
    )

    error = commit_or_conflict(db, request)
    return error or RuleVersionSummary.model_validate(target)