import json
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import select

from app.auth.security import verify_password
from app.auth.seed_demo import (
    DEMO_ACCOUNTS,
    DEMO_DEPARTMENTS,
    passwords_from_environment,
    seed_demo,
)
from app.models import Department, User


@pytest.fixture
def demo_passwords():
    return {
        account.password_env: f"Demo-password-for-{index}-2026!"
        for index, account in enumerate(DEMO_ACCOUNTS)
    }


def test_demo_seed_is_repeatable_and_matches_shared_principals(db_session, demo_passwords):
    principals = json.loads(
        (Path(__file__).parents[2] / "docs" / "fixtures" / "principals.json").read_text()
    )
    assert {(str(id), name) for id, name in DEMO_DEPARTMENTS} == {
        (department["id"], department["name"]) for department in principals["departments"]
    }
    assert {
        (
            str(account.id),
            account.role,
            str(account.department_id) if account.department_id else None,
        )
        for account in DEMO_ACCOUNTS
    } == {
        (principal["user_id"], principal["role"], principal["department_id"])
        for principal in principals["principals"]
    }

    assert seed_demo(db_session, demo_passwords) == (4, 5)
    first_hashes = {
        account.id: db_session.get(User, account.id).password_hash for account in DEMO_ACCOUNTS
    }

    assert seed_demo(db_session, demo_passwords) == (0, 0)
    assert (
        len(
            db_session.scalars(
                select(Department).where(Department.id.in_([id for id, _ in DEMO_DEPARTMENTS]))
            ).all()
        )
        == 4
    )
    assert (
        len(
            db_session.scalars(
                select(User).where(User.id.in_([account.id for account in DEMO_ACCOUNTS]))
            ).all()
        )
        == 5
    )
    assert {account.role for account in DEMO_ACCOUNTS} == {
        "reporter",
        "handler",
        "department_manager",
        "administrator",
    }

    for account in DEMO_ACCOUNTS:
        user = db_session.get(User, account.id)
        assert user.password_hash == first_hashes[account.id]
        assert user.password_hash != demo_passwords[account.password_env]
        assert verify_password(demo_passwords[account.password_env], user.password_hash)
        assert user.department_id == account.department_id


def test_demo_seed_rejects_a_changed_password(db_session, demo_passwords):
    seed_demo(db_session, demo_passwords)
    reporter = db_session.get(User, DEMO_ACCOUNTS[0].id)
    original_hash = reporter.password_hash
    demo_passwords[DEMO_ACCOUNTS[0].password_env] = "Different-demo-password-2026!"

    with pytest.raises(ValueError, match="password differs"):
        seed_demo(db_session, demo_passwords)
    assert reporter.password_hash == original_hash


def test_demo_seed_rejects_existing_email_with_different_id(db_session, demo_passwords):
    db_session.add(
        User(
            id=UUID("10000000-0000-4000-8000-999999999999"),
            email=DEMO_ACCOUNTS[0].email,
            display_name="Existing User",
            password_hash="unused",
            role="reporter",
            is_active=True,
        )
    )
    db_session.flush()

    with pytest.raises(ValueError, match="already belongs to another ID"):
        seed_demo(db_session, demo_passwords)


def test_demo_passwords_must_come_from_environment(monkeypatch):
    for account in DEMO_ACCOUNTS:
        monkeypatch.delenv(account.password_env, raising=False)

    with pytest.raises(ValueError, match="CIM_DEMO_REPORTER_PASSWORD"):
        passwords_from_environment()


def test_demo_password_placeholder_is_rejected(monkeypatch, demo_passwords):
    for name, password in demo_passwords.items():
        monkeypatch.setenv(name, password)
    monkeypatch.setenv(DEMO_ACCOUNTS[0].password_env, "replace-with-random-hex")

    with pytest.raises(ValueError, match="placeholders"):
        passwords_from_environment()
