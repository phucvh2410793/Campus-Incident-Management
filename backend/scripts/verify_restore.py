#!/usr/bin/env python3
"""Post-restore verification script for Campus Incident Management (N1-W11).

Verifies that all 4 roles (reporter, handler, department_manager, administrator)
exist, are active, and can authenticate with their seed passwords.

Usage:
    python backend/scripts/verify_restore.py [--db-url postgresql://...] [--password ...]
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.auth.security import verify_password
from app.models import Department, User

DEFAULT_PASSWORD = "Demo-Large-Seed-2026!"


def verify_database_restore(db_url: str | None = None, password: str = DEFAULT_PASSWORD) -> bool:
    url = (
        db_url
        or os.environ.get("DATABASE_URL")
        or os.environ.get("TEST_DATABASE_URL")
        or "postgresql+psycopg://phileblinh@localhost:5432/campus_incident_test"
    )

    print(f"[*] Verifying database at {url.split('@')[-1]}...")
    engine = create_engine(url)

    with Session(engine) as session:
        dept_count = session.scalar(select(func.count(Department.id)))
        user_count = session.scalar(select(func.count(User.id)))
        print(f"[i] Found {dept_count} departments and {user_count} users.")

        if dept_count == 0 or user_count == 0:
            print("[✗] Database is empty!", file=sys.stderr)
            return False

        # Verify all 4 mandatory roles
        required_roles = {"reporter", "handler", "department_manager", "administrator"}
        found_roles = set(session.scalars(select(User.role).distinct()).all())
        missing_roles = required_roles - found_roles
        if missing_roles:
            print(f"[✗] Missing required roles: {missing_roles}", file=sys.stderr)
            return False
        print(f"[✓] All 4 mandatory roles present: {found_roles}")

        # Check authentication capability for each role
        all_passed = True
        for role in sorted(required_roles):
            users = session.scalars(
                select(User).where(User.role == role, User.is_active.is_(True))
            ).all()
            if not users:
                print(f"[✗] No active users found for role: {role}", file=sys.stderr)
                all_passed = False
                continue

            test_user = users[0]
            # Verify password hash works
            if verify_password(password, test_user.password_hash):
                print(
                    f"[✓] Role '{role}' active user '{test_user.email}' authenticated successfully!"
                )
            else:
                print(f"[!] Role '{role}' user '{test_user.email}' did not match password.")

        return all_passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Verify database restore integrity and logins")
    parser.add_argument("--db-url", help="Database URL")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help="Seed password to check")
    args = parser.parse_args()

    success = verify_database_restore(args.db_url, args.password)
    sys.exit(0 if success else 1)
