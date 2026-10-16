
import json
from pathlib import Path
from uuid import UUID

import pytest

from app.auth.policy import Principal, RolePolicy

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
    assert len(departments) == 2
    assert {item["role"] for item in FIXTURE["principals"]} == {
        "reporter", "handler", "department_manager", "administrator"
    }
    assert len({item["user_id"] for item in FIXTURE["principals"]}) == 4
    for item in FIXTURE["principals"]:
        UUID(item["user_id"])
        if item["department_id"] is not None:
            assert item["department_id"] in departments


def test_unknown_role_or_action_is_denied():
    policy = RolePolicy()
    assert not policy.allows(Principal("id", "unknown_role", None), "manage_users")
    assert not policy.allows(Principal("id", "reporter", None), "unknown_action")
