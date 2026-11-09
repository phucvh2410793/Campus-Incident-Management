"""W5 read endpoints: database scope, filters and keyset pagination."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.auth.security import hash_password
from app.incidents.models import Incident
from app.models import Department, User

NOW = datetime(2026, 11, 9, 12, tzinfo=UTC)
PASSWORD = "Test-password-123!"


def make_user(client, db_session, role, department_id=None):
    user = User(
        id=uuid4(),
        email=f"read-{uuid4().hex}@example.com",
        display_name="Read test user",
        password_hash=hash_password(PASSWORD),
        role=role,
        department_id=department_id,
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()
    login = client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return user, {"Authorization": f"Bearer {login.json()['access_token']}"}


def make_incident(db_session, reporter_id, number, **overrides):
    values = {
        "id": UUID(int=number),
        "reporter_id": reporter_id,
        "category": "water_leak",
        "title": f"Leak report {number}",
        "description": "Water is leaking near a classroom and needs attention.",
        "building": "Building A",
        "answers": {"leak_amount": "small", "near_electricity": "no"},
        "reported_at": NOW,
    }
    values.update(overrides)
    incident = Incident(**values)
    db_session.add(incident)
    db_session.flush()
    return incident


def test_list_scope_and_detail_hide_outside_records(client, db_session, test_user, auth_headers):
    department = Department(id=uuid4(), name=f"Test department {uuid4().hex}")
    other_department = Department(id=uuid4(), name=f"Other department {uuid4().hex}")
    db_session.add_all([department, other_department])
    db_session.flush()
    other, other_headers = make_user(client, db_session, "reporter")
    handler, handler_headers = make_user(client, db_session, "handler", department.id)
    manager, manager_headers = make_user(client, db_session, "department_manager", department.id)
    admin, admin_headers = make_user(client, db_session, "administrator")

    own = make_incident(db_session, test_user.id, 1, assigned_handler_id=handler.id)
    in_department = make_incident(db_session, other.id, 2, department_id=department.id)
    elsewhere = make_incident(db_session, other.id, 3, department_id=other_department.id)
    handler_own = make_incident(db_session, handler.id, 4)
    manager_own = make_incident(db_session, manager.id, 5)

    def ids(headers):
        response = client.get("/api/v1/incidents", headers=headers)
        assert response.status_code == 200, response.text
        assert response.headers.get("X-Request-ID")
        return {item["id"] for item in response.json()["items"]}

    assert ids(auth_headers) == {str(own.id)}
    assert ids(handler_headers) == {str(own.id), str(handler_own.id)}
    assert ids(manager_headers) == {str(in_department.id), str(manager_own.id)}
    assert ids(admin_headers) == {
        str(own.id),
        str(in_department.id),
        str(elsewhere.id),
        str(handler_own.id),
        str(manager_own.id),
    }
    assert ids(other_headers) == {str(in_department.id), str(elsewhere.id)}
    assert (
        client.get(
            "/api/v1/incidents",
            params={"department_id": str(other_department.id)},
            headers=auth_headers,
        ).json()["items"]
        == []
    )

    admin_page = client.get("/api/v1/incidents?limit=1", headers=admin_headers)
    scoped_page = client.get(
        "/api/v1/incidents",
        params={"cursor": admin_page.json()["next_cursor"]},
        headers=auth_headers,
    )
    assert {item["id"] for item in scoped_page.json()["items"]} <= {str(own.id)}

    own_detail = client.get(f"/api/v1/incidents/{own.id}", headers=auth_headers)
    assert own_detail.status_code == 200
    assert own_detail.json()["assigned_handler_id"] is None
    staff_detail = client.get(f"/api/v1/incidents/{own.id}", headers=handler_headers)
    assert staff_detail.json()["assigned_handler_id"] == str(handler.id)
    hidden = client.get(f"/api/v1/incidents/{elsewhere.id}", headers=auth_headers)
    missing = client.get(f"/api/v1/incidents/{uuid4()}", headers=auth_headers)
    assert hidden.status_code == missing.status_code == 404
    assert hidden.json()["error"]["code"] == missing.json()["error"]["code"] == "not_found"
    assert client.get("/api/v1/incidents").status_code == 401


def test_cursor_is_stable_and_filters_stay_inside_scope(
    client, db_session, test_user, auth_headers
):
    other, _ = make_user(client, db_session, "reporter")
    department = Department(id=uuid4(), name=f"Filter department {uuid4().hex}")
    db_session.add(department)
    db_session.flush()
    first = make_incident(
        db_session,
        test_user.id,
        103,
        department_id=department.id,
        category="phishing",
        priority="p1",
        triage_required=True,
        acknowledgment_deadline_at=datetime.now(UTC) - timedelta(days=1),
    )
    second = make_incident(db_session, test_user.id, 102, department_id=department.id)
    third = make_incident(db_session, test_user.id, 101, status="assigned")
    make_incident(db_session, other.id, 104, department_id=department.id)

    page1 = client.get("/api/v1/incidents?limit=2", headers=auth_headers)
    assert page1.status_code == 200, page1.text
    assert [x["id"] for x in page1.json()["items"]] == [str(first.id), str(second.id)]
    cursor = page1.json()["next_cursor"]
    assert cursor
    make_incident(db_session, test_user.id, 105, reported_at=NOW + timedelta(seconds=1))
    page2 = client.get(
        "/api/v1/incidents", params={"limit": 2, "cursor": cursor}, headers=auth_headers
    )
    assert [x["id"] for x in page2.json()["items"]] == [str(third.id)]
    assert page2.json()["next_cursor"] is None

    filters = {
        "category": "phishing",
        "priority": "p1",
        "department_id": str(department.id),
        "triage_required": "true",
        "overdue": "true",
        "status": "reported",
    }
    filtered = client.get("/api/v1/incidents", params=filters, headers=auth_headers)
    assert [x["id"] for x in filtered.json()["items"]] == [str(first.id)]
    assert filtered.json()["items"][0]["overdue"] is True
    assert (
        client.get("/api/v1/incidents", params=filters, headers=auth_headers).json()["next_cursor"]
        is None
    )
    not_overdue = client.get("/api/v1/incidents?overdue=false", headers=auth_headers)
    assert str(first.id) not in {item["id"] for item in not_overdue.json()["items"]}
    for params in ({"cursor": "not-a-cursor"}, {"limit": 101}, {"status": "unknown"}):
        invalid = client.get("/api/v1/incidents", params=params, headers=auth_headers)
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == "validation_error"
