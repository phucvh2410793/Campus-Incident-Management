"""Rule routing and manual triage against the real incident API and database."""

from uuid import uuid4

import pytest
from sqlalchemy import select
from test_incident_create_api import WATER_LEAK

from app.auth.security import hash_password
from app.incidents.models import Incident
from app.models import Department, User
from app.rules.models import RuleEvaluation, RuleVersion


@pytest.fixture
def rule_departments(db_session):
    departments = {}
    for name in ("Cơ sở vật chất", "Điện và an toàn", "IT/Security"):
        department = db_session.scalar(select(Department).where(Department.name == name))
        if department is None:
            department = Department(name=name)
            db_session.add(department)
        departments[name] = department
    db_session.flush()
    return departments


def admin_headers(client, db_session):
    admin = User(
        email=f"admin-{uuid4().hex}@example.com",
        display_name="Rule administrator",
        password_hash=hash_password("Test-password-123!"),
        role="administrator",
        is_active=True,
    )
    db_session.add(admin)
    db_session.flush()
    response = client.post(
        "/api/v1/auth/login",
        json={"email": admin.email, "password": "Test-password-123!"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.parametrize(
    ("category", "answers", "department_name", "priority"),
    [
        ("water_leak", WATER_LEAK["answers"], "Cơ sở vật chất", "p3"),
        (
            "electrical_hazard",
            {"exposed_wire": "yes", "smoke_or_sparks": "no"},
            "Điện và an toàn",
            "p1",
        ),
        ("phishing", {"interaction": "none", "channel": "email"}, "IT/Security", "p3"),
    ],
)
def test_three_mvp_categories_route_and_record_rule_history(
    client, auth_headers, db_session, rule_departments, category, answers, department_name, priority
):
    response = client.post(
        "/api/v1/incidents",
        json={**WATER_LEAK, "category": category, "answers": answers},
        headers={**auth_headers, "Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["department_id"] == str(rule_departments[department_name].id)
    assert body["priority"] == priority
    assert body["status"] == "reported"
    incident = db_session.scalar(select(Incident).where(Incident.id == body["id"]))
    assert incident is not None
    assert (
        len(
            db_session.scalars(
                select(RuleEvaluation).where(RuleEvaluation.incident_id == incident.id)
            ).all()
        )
        == 1
    )


def test_manual_triage_keeps_history_and_rejects_stale_version(
    client, auth_headers, db_session, rule_departments
):
    created = client.post(
        "/api/v1/incidents",
        json=WATER_LEAK,
        headers={**auth_headers, "Idempotency-Key": str(uuid4())},
    )
    assert created.status_code == 201, created.text
    incident_id = created.json()["id"]
    headers = admin_headers(client, db_session)
    triage = client.post(
        f"/api/v1/incidents/{incident_id}/triage",
        json={
            "expected_version": 1,
            "department_id": str(rule_departments["Điện và an toàn"].id),
            "severity": "medium",
            "priority": "p2",
            "reason": "Manual review",
        },
        headers=headers,
    )
    assert triage.status_code == 200, triage.text
    assert triage.json()["version"] == 2
    assert triage.json()["triage_required"] is False
    stale = client.post(
        f"/api/v1/incidents/{incident_id}/triage",
        json={
            "expected_version": 1,
            "department_id": str(rule_departments["Điện và an toàn"].id),
            "severity": "medium",
            "priority": "p2",
            "reason": "Stale change",
        },
        headers=headers,
    )
    assert stale.status_code == 409
    history = client.get(f"/api/v1/incidents/{incident_id}/rule-evaluations", headers=headers)
    assert history.status_code == 200, history.text
    assert len(history.json()) == 2


def test_new_rule_version_changes_department_only_after_explicit_reevaluation(
    client, auth_headers, db_session, rule_departments
):
    created = client.post(
        "/api/v1/incidents",
        json=WATER_LEAK,
        headers={**auth_headers, "Idempotency-Key": str(uuid4())},
    )
    assert created.status_code == 201, created.text
    original = created.json()
    old_version = db_session.scalar(select(RuleVersion).where(RuleVersion.version == "demo-v1"))
    assert old_version is not None
    changed_rules = [dict(rule) for rule in old_version.rules]
    for rule in changed_rules:
        if rule["rule_id"] == "R07":
            rule["department"] = "Điện và an toàn"
    old_version.is_active = False
    db_session.add(RuleVersion(version="demo-v2-test", rules=changed_rules, is_active=True))
    db_session.flush()

    unchanged = client.get(f"/api/v1/incidents/{original['id']}", headers=auth_headers)
    assert unchanged.status_code == 200
    assert unchanged.json()["department_id"] == str(rule_departments["Cơ sở vật chất"].id)

    headers = admin_headers(client, db_session)
    reevaluated = client.post(
        f"/api/v1/incidents/{original['id']}/reevaluate",
        json={"expected_version": 1},
        headers=headers,
    )
    assert reevaluated.status_code == 200, reevaluated.text
    assert reevaluated.json()["version"] == 2
    assert reevaluated.json()["department_id"] == str(rule_departments["Điện và an toàn"].id)
    history = client.get(f"/api/v1/incidents/{original['id']}/rule-evaluations", headers=headers)
    assert history.status_code == 200
    evaluations = history.json()
    assert len(evaluations) == 2
    assert evaluations[0]["rule_version_id"] != evaluations[1]["rule_version_id"]
