import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import main
from app.auth.dependencies import get_db
from app.auth.security import hash_password
from app.models import User


def get_test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")

    if not url:
        raise RuntimeError(
            "TEST_DATABASE_URL is missing. "
            "Set it to the campus_incident_test database."
        )

    database_name = url.split("?", 1)[0].rsplit("/", 1)[-1]

    if database_name != "campus_incident_test":
        raise RuntimeError(
            "Tests must use the campus_incident_test database."
        )

    return url


@pytest.fixture(scope="session")
def test_engine():
    engine = create_engine(
        get_test_database_url(),
        pool_pre_ping=True,
    )

    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def db_session(test_engine):
    connection = test_engine.connect()
    transaction = connection.begin()

    TestingSessionLocal = sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    db = TestingSessionLocal()

    try:
        yield db
    finally:
        db.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    main.app.dependency_overrides[get_db] = override_get_db

    try:
        with TestClient(main.app) as test_client:
            yield test_client
    finally:
        main.app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def test_user(db_session):
    user = User(
        id=uuid4(),
        email=f"test-{uuid4().hex[:12]}@example.com",
        display_name="Test User",
        password_hash=hash_password("Test-password-123!"),
        role="reporter",
        is_active=True,
    )

    db_session.add(user)
    db_session.flush()

    return user


@pytest.fixture
def auth_headers(client, test_user):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": test_user.email,
            "password": "Test-password-123!",
        },
    )

    assert response.status_code == 200, response.text

    token = response.json()["access_token"]

    return {"Authorization": f"Bearer {token}"}
