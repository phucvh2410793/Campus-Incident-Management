import json
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from app.auth.policy import IncidentPolicy, Principal, RolePolicy
from app.incidents.models import Incident

FIXTURE = json.loads(
    (Path(__file__).parents[2] / "docs" / "fixtures" / "principals.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize(
    ("action", "allowed_roles"),
    [
        ("report_incident", {"reporter", "handler", "department_manager", "administrator"}),
        ("view_assigned_incidents", {"handler", "department_manager", "administrator"}),
        ("manage_department", {"administrator"}),
        ("manage_users", {"administrator"}),
        ("manage_roles", {"administrator"}),
    ],
)
@pytest.mark.parametrize("principal_data", FIXTURE["principals"], ids=lambda item: item["role"])
def test_role_permissions(principal_data, action, allowed_roles):
    principal = Principal(**principal_data)
    assert RolePolicy().allows(principal, action) is (principal.role in allowed_roles)


def test_shared_principal_fixture_is_complete():
    assert FIXTURE["schema_version"] == 1
    departments = {item["id"] for item in FIXTURE["departments"]}
    assert len(departments) == 4
    assert {item["role"] for item in FIXTURE["principals"]} == {
        "reporter",
        "handler",
        "department_manager",
        "administrator",
    }
    assert len({item["user_id"] for item in FIXTURE["principals"]}) == 5
    triage_department_id = next(
        item["id"]
        for item in FIXTURE["departments"]
        if item["name"] == "Hàng đợi phân loại thủ công"
    )
    assert any(
        item["role"] == "department_manager" and item["department_id"] == triage_department_id
        for item in FIXTURE["principals"]
    )
    for item in FIXTURE["principals"]:
        UUID(item["user_id"])
        if item["department_id"] is not None:
            assert item["department_id"] in departments


def test_unknown_role_or_action_is_denied():
    policy = RolePolicy()
    assert not policy.allows(Principal("id", "unknown_role", None), "manage_users")
    assert not policy.allows(Principal("id", "reporter", None), "unknown_action")


@pytest.fixture
def record_case():
    people = {item["role"]: Principal(**item) for item in FIXTURE["principals"][:4]}
    incident = Incident(
        id=uuid4(),
        reporter_id=UUID(people["reporter"].user_id),
        assigned_handler_id=UUID(people["handler"].user_id),
        department_id=UUID(people["handler"].department_id),
    )
    manager = Principal(
        people["department_manager"].user_id,
        "department_manager",
        people["handler"].department_id,
    )
    return incident, people, manager


@pytest.mark.parametrize(
    ("role", "visible"),
    [
        ("reporter", True),
        ("handler", True),
        ("department_manager", False),
        ("administrator", True),
    ],
)
def test_record_scope_uses_shared_principal_fixture(record_case, role, visible):
    incident, people, _ = record_case
    decision = IncidentPolicy().evaluate(people[role], incident, "view")
    assert decision.allowed is visible
    if not visible:
        assert (decision.code, decision.http_status) == ("not_found", 404)


def test_manager_scope_follows_department_and_handler_scope_follows_assignment(record_case):
    incident, people, manager = record_case
    policy = IncidentPolicy()
    assert policy.evaluate(manager, incident, "view").allowed

    incident.assigned_handler_id = uuid4()
    assert policy.evaluate(people["handler"], incident, "view").http_status == 404
    incident.department_id = uuid4()
    assert policy.evaluate(manager, incident, "view").http_status == 404


@pytest.mark.parametrize(
    ("actor", "action", "code", "status"),
    [
        ("reporter", "assign", "forbidden", 403),
        ("handler", "assign", "forbidden", 403),
        ("reporter", "comment_internal", "forbidden", 403),
        ("reporter", "read_internal_comment", "not_found", 404),
        ("reporter", "unknown_action", "forbidden", 403),
        ("department_manager", "assign", "not_found", 404),
    ],
)
def test_visible_action_denial_and_hidden_scope(record_case, actor, action, code, status):
    incident, people, _ = record_case
    decision = IncidentPolicy().evaluate(people[actor], incident, action)
    assert not decision.allowed
    assert (decision.code, decision.http_status) == (code, status)


def test_manager_and_admin_can_assign_but_unknown_role_cannot_view(record_case):
    incident, people, manager = record_case
    policy = IncidentPolicy()
    assert policy.evaluate(manager, incident, "assign").allowed
    assert policy.evaluate(people["administrator"], incident, "assign").allowed
    unknown = Principal(people["reporter"].user_id, "unknown", None)
    assert policy.evaluate(unknown, incident, "view").http_status == 404


@pytest.mark.parametrize("role", ["handler", "department_manager"])
def test_staff_can_view_own_report_without_operational_rights(record_case, role):
    incident, people, _ = record_case
    owner = Principal(
        user_id=people["reporter"].user_id,
        role=role,
        department_id=people["handler"].department_id,
    )
    incident.department_id = uuid4()
    policy = IncidentPolicy()

    assert policy.evaluate(owner, incident, "view").allowed
    assert policy.evaluate(owner, incident, "comment_public").allowed
    assert policy.evaluate(owner, incident, "evidence").allowed
    assert policy.evaluate(owner, incident, "read_internal_comment").http_status == 404
    assert policy.evaluate(owner, incident, "comment_internal").http_status == 403
    assert policy.evaluate(owner, incident, "work").http_status == 403
    assert policy.evaluate(owner, incident, "assign").http_status == 403
