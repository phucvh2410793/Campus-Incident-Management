
import pytest

from app.auth.policy import Principal, RolePolicy


@pytest.fixture
def policy():
    return RolePolicy()


@pytest.mark.parametrize(
    ("role", "action", "expected"),
    [
        ("reporter", "report_incident", True),
        ("handler", "report_incident", True),
        ("department_manager", "report_incident", True),
        ("administrator", "report_incident", True),
        ("reporter", "manage_users", False),
        ("handler", "manage_users", False),
        ("department_manager", "manage_users", False),
        ("administrator", "manage_users", True),
        ("reporter", "manage_roles", False),
        ("administrator", "manage_roles", True),
        ("unknown_role", "manage_users", False),
        ("reporter", "unknown_action", False),
    ],
)
def test_role_permissions(policy, role, action, expected):
    principal = Principal(
        user_id="test-user",
        role=role,
        department_id=None,
    )

    assert policy.allows(principal, action) is expected
