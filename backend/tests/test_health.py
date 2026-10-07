import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app import main


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def test_liveness_does_not_require_database(client, monkeypatch):
    def database_down():
        raise OperationalError("connection", {}, Exception("private-credential"))

    monkeypatch.setattr(main, "check_database", database_down)
    assert client.get("/api/v1/health/live").status_code == 200


def test_readiness_failure_does_not_leak_credentials(client, monkeypatch):
    def database_down():
        raise OperationalError("connection", {}, Exception("private-credential"))

    monkeypatch.setattr(main, "check_database", database_down)
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert "private-credential" not in response.text


def test_readiness_success(client, monkeypatch):
    monkeypatch.setattr(main, "check_database", lambda: None)
    assert client.get("/api/v1/health/ready").json()["database"] == "reachable"


def test_cors_rejects_untrusted_origin(client):
    response = client.options(
        "/api/v1/health/live",
        headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
