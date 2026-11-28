"""Week 11 (N1-W11) PostgreSQL Backup, Restore on Clean Database & Verification Test.

Validates:
- pg_dump backup execution and output validity.
- Complete restoration into a clean, empty PostgreSQL database.
- Integrity: table counts, foreign keys, and indexes restored cleanly.
- Authentication: all 4 mandatory roles (reporter, handler, department_manager,
  administrator) can log in and obtain valid bearer tokens on the restored database.
"""

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.auth.dependencies import get_db
from app.auth.seed_large import (
    DEFAULT_LARGE_PASSWORD,
    create_scoped_incidents_for_matrix,
    seed_large_dataset,
)
from app.main import app
from app.models import Department, User
from scripts.backup_db import backup_database
from scripts.restore_db import restore_database
from scripts.verify_restore import verify_database_restore

CLEAN_TEST_DB_NAME = "campus_incident_restore_test"
@pytest.fixture(scope="module")
def clean_postgres_db():
    """Create a completely clean PostgreSQL database and drop it when done."""
    source_url = make_url(os.environ["TEST_DATABASE_URL"])
    clean_url = source_url.set(database=CLEAN_TEST_DB_NAME)
    admin_engine = create_engine(source_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {CLEAN_TEST_DB_NAME} WITH (FORCE)"))
        conn.execute(text(f"CREATE DATABASE {CLEAN_TEST_DB_NAME}"))
    try:
        yield clean_url.render_as_string(hide_password=False)
    finally:
        with admin_engine.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {CLEAN_TEST_DB_NAME} WITH (FORCE)"))
        admin_engine.dispose()


def test_backup_and_restore_on_clean_database_allows_all_roles_to_login(
    test_engine, clean_postgres_db
):
    source_url = os.environ["TEST_DATABASE_URL"]

    # 1. Commit seed dataset to source PostgreSQL database so external pg_dump can read it
    with test_engine.connect() as conn:
        with Session(bind=conn) as sess:
            source_dataset = seed_large_dataset(sess, DEFAULT_LARGE_PASSWORD)
            create_scoped_incidents_for_matrix(sess, source_dataset)
            sess.commit()
        conn.commit()

    # 2. Perform backup dump to a temporary file
    with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as tmp_file:
        dump_path = Path(tmp_file.name)

    try:
        backup_database(db_url=source_url, out_path=str(dump_path))

        assert dump_path.exists()
        assert dump_path.stat().st_size > 1024, "Backup file should be larger than 1KB"

        # Verify dump content includes essential schema and table directives
        content = dump_path.read_text(encoding="utf-8", errors="ignore")
        assert "CREATE TABLE public.users" in content or "COPY public.users" in content
        assert "CREATE TABLE public.departments" in content or "COPY public.departments" in content

        # 3. Restore dump into clean secondary PostgreSQL database
        restore_database(str(dump_path), db_url=clean_postgres_db)

        # 4. Verify restored DB using verify_restore script logic
        verified = verify_database_restore(clean_postgres_db, DEFAULT_LARGE_PASSWORD)
        assert verified is True, "Post-restore verification must report success"

        # 5. Connect directly to restored database and verify live logins
        restored_engine = create_engine(clean_postgres_db)
        with Session(restored_engine) as restored_session:
            # Check row counts
            dept_count = restored_session.scalar(select(func.count(Department.id)))
            user_count = restored_session.scalar(select(func.count(User.id)))
            assert dept_count >= 8
            assert user_count >= 25

            # 6. Verify authentication via FastAPI TestClient on restored database
            def override_restored_db():
                yield restored_session

            app.dependency_overrides[get_db] = override_restored_db

            try:
                client = TestClient(app)
                roles_to_test = [
                    ("reporter", "reporter@demo.invalid"),
                    ("handler", "handler@demo.invalid"),
                    ("department_manager", "manager@demo.invalid"),
                    ("administrator", "admin@demo.invalid"),
                ]

                for role_name, email in roles_to_test:
                    login_resp = client.post(
                        "/api/v1/auth/login",
                        json={"email": email, "password": DEFAULT_LARGE_PASSWORD},
                    )
                    assert login_resp.status_code == 200, (
                        f"Role '{role_name}' ({email}) should log in with 200 on restored DB"
                    )
                    body = login_resp.json()
                    assert "access_token" in body
                    assert body["user"]["role"] == role_name
                    assert body["user"]["email"] == email

                    # Test /api/v1/auth/me with the restored token
                    token = body["access_token"]
                    me_resp = client.get(
                        "/api/v1/auth/me",
                        headers={"Authorization": f"Bearer {token}"},
                    )
                    assert me_resp.status_code == 200
                    assert me_resp.json()["email"] == email
            finally:
                app.dependency_overrides.pop(get_db, None)

        restored_engine.dispose()

    finally:
        if dump_path.exists():
            dump_path.unlink()

        # Clean source DB for subsequent tests
        with test_engine.connect() as conn:
            with Session(bind=conn) as sess:
                sess.execute(
                    text(
                        """
                    TRUNCATE TABLE incident_supplements, incident_attachments,
                    comments, assignments,
                    audit_logs, rule_evaluations, escalations, incidents,
                    idempotency_records, user_sessions, users, departments CASCADE
                """
                    )
                )
                sess.commit()
            conn.commit()
