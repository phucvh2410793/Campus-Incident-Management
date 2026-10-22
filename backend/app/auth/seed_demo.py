"""Explicit, repeatable demo identity seed. No credentials are stored in Git."""

import os
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.security import hash_password, verify_password
from app.db import SessionLocal
from app.models import Department, User


@dataclass(frozen=True)
class DemoAccount:
    id: UUID
    email: str
    display_name: str
    role: str
    department_id: UUID | None
    password_env: str


# IDs match docs/fixtures/principals.json so other workstreams can share them.
DEMO_DEPARTMENTS = (
    (UUID("20000000-0000-4000-8000-000000000001"), "Cơ sở vật chất"),
    (UUID("20000000-0000-4000-8000-000000000002"), "Điện và an toàn"),
    (UUID("20000000-0000-4000-8000-000000000003"), "IT/Security"),
    (UUID("20000000-0000-4000-8000-000000000004"), "Hàng đợi phân loại thủ công"),
)

DEMO_ACCOUNTS = (
    DemoAccount(
        UUID("10000000-0000-4000-8000-000000000001"),
        "reporter@demo.invalid",
        "Demo Reporter",
        "reporter",
        None,
        "CIM_DEMO_REPORTER_PASSWORD",
    ),
    DemoAccount(
        UUID("10000000-0000-4000-8000-000000000002"),
        "handler@demo.invalid",
        "Demo Handler",
        "handler",
        DEMO_DEPARTMENTS[0][0],
        "CIM_DEMO_HANDLER_PASSWORD",
    ),
    DemoAccount(
        UUID("10000000-0000-4000-8000-000000000003"),
        "manager@demo.invalid",
        "Demo Department Manager",
        "department_manager",
        DEMO_DEPARTMENTS[1][0],
        "CIM_DEMO_MANAGER_PASSWORD",
    ),
    DemoAccount(
        UUID("10000000-0000-4000-8000-000000000004"),
        "admin@demo.invalid",
        "Demo Administrator",
        "administrator",
        None,
        "CIM_DEMO_ADMIN_PASSWORD",
    ),
    DemoAccount(
        UUID("10000000-0000-4000-8000-000000000005"),
        "triage.manager@demo.invalid",
        "Demo Triage Manager",
        "department_manager",
        DEMO_DEPARTMENTS[3][0],
        "CIM_DEMO_TRIAGE_MANAGER_PASSWORD",
    ),
)


def passwords_from_environment() -> dict[str, str]:
    """Require all demo passwords before making any database change."""
    passwords = {
        account.password_env: os.environ.get(account.password_env, "") for account in DEMO_ACCOUNTS
    }
    missing = [name for name, value in passwords.items() if len(value) < 12]
    if missing:
        raise ValueError("Set passwords of at least 12 characters: " + ", ".join(missing))
    if any(value == "replace-with-random-hex" for value in passwords.values()):
        raise ValueError("Replace demo password placeholders in the untracked .env file")
    if len(set(passwords.values())) != len(passwords):
        raise ValueError("Use a different password for each demo account")
    return passwords


def seed_demo(session: Session, passwords: dict[str, str]) -> tuple[int, int]:
    """Insert fixed demo identities; reruns leave existing accounts unchanged."""
    if any(len(passwords.get(account.password_env, "")) < 12 for account in DEMO_ACCOUNTS):
        raise ValueError("All demo account passwords must be at least 12 characters")

    created_departments = 0
    created_users = 0
    for department_id, name in DEMO_DEPARTMENTS:
        existing = session.get(Department, department_id)
        if existing is None:
            if session.scalar(select(Department.id).where(Department.name == name)) is not None:
                raise ValueError(f"Demo department name already belongs to another ID: {name}")
            session.add(Department(id=department_id, name=name))
            created_departments += 1
        elif existing.name != name:
            raise ValueError(f"Demo department ID already has a different name: {department_id}")
    session.flush()

    for account in DEMO_ACCOUNTS:
        existing = session.get(User, account.id)
        if existing is None:
            if session.scalar(select(User.id).where(User.email == account.email)) is not None:
                raise ValueError(f"Demo email already belongs to another ID: {account.email}")
            session.add(
                User(
                    id=account.id,
                    email=account.email,
                    display_name=account.display_name,
                    password_hash=hash_password(passwords[account.password_env]),
                    role=account.role,
                    department_id=account.department_id,
                    is_active=True,
                )
            )
            created_users += 1
        else:
            if (
                existing.email != account.email
                or existing.role != account.role
                or existing.department_id != account.department_id
            ):
                raise ValueError(f"Demo user ID conflicts with existing account: {account.id}")
            password = passwords[account.password_env]
            if not verify_password(password, existing.password_hash):
                raise ValueError(f"Demo password differs for existing account: {account.email}")
    session.flush()
    return created_departments, created_users


def main() -> None:
    passwords = passwords_from_environment()
    with SessionLocal.begin() as session:
        departments, users = seed_demo(session, passwords)
    print(f"Demo seed complete: {departments} departments and {users} users created")


if __name__ == "__main__":
    main()
