"""W6/W7 API acceptance checks against PostgreSQL and private file storage."""

from uuid import uuid4

import pytest
from sqlalchemy import func, select
from test_incident_read_api import make_incident, make_user

from app.core.config import get_settings
from app.evidence.models import IncidentAttachment
from app.incidents.supplements import IncidentSupplement
from app.models import Department
from app.workflow.models import AuditLog, StatusHistory

PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF"


def test_supplement_is_atomic_versioned_and_public(client, db_session, test_user, auth_headers):
    incident = make_incident(db_session, test_user.id, 401)
    other, other_headers = make_user(client, db_session, "reporter")
    url = f"/api/v1/incidents/{incident.id}"
    body = {"text": "  Water is spreading to the next room.  ", "expected_version": 1}
    assert client.post(f"{url}/supplements", json=body, headers=other_headers).status_code == 404
    created = client.post(f"{url}/supplements", json=body, headers=auth_headers)
    assert created.status_code == 201, created.text
    assert created.json()["incident_version"] == 2
    assert db_session.get(IncidentSupplement, created.json()["id"]).text == body["text"].strip()
    stale = client.post(f"{url}/supplements", json=body, headers=auth_headers)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"
    assert db_session.scalar(select(func.count()).select_from(IncidentSupplement)) == 1
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 1
    assert db_session.get(type(incident), incident.id).version == 2
    history = client.get(f"{url}/history?limit=1", headers=auth_headers)
    assert history.status_code == 200, history.text
    assert history.json()["items"][0]["action"] == "incident.supplemented"
    assert history.json()["items"][0]["details"]["text"] == body["text"].strip()
    assert history.json()["next_cursor"]
    second = client.get(
        f"{url}/history", params={"cursor": history.json()["next_cursor"]}, headers=auth_headers
    )
    assert [item["action"] for item in second.json()["items"]] == ["incident.created"]
    assert client.get(f"{url}/history?cursor=bad", headers=auth_headers).status_code == 422
    assert other.id != test_user.id


def test_supplement_permissions_state_and_private_history(
    client, db_session, test_user, auth_headers
):
    incident = make_incident(db_session, test_user.id, 402)
    admin, admin_headers = make_user(client, db_session, "administrator")
    department = Department(id=uuid4(), name=f"W6 department {uuid4().hex}")
    db_session.add(department)
    db_session.flush()
    handler, handler_headers = make_user(client, db_session, "handler", department.id)
    incident.department_id = department.id
    incident.assigned_handler_id = handler.id
    db_session.add(StatusHistory(
        id=uuid4(), incident_id=incident.id, actor_id=handler.id,
        from_status="reported", to_status="assigned", incident_version=2,
        visibility="internal", created_at=incident.reported_at,
    ))
    db_session.flush()
    db_session.commit()
    url = f"/api/v1/incidents/{incident.id}"
    assert client.post(
        f"{url}/supplements", json={"text": "More details", "expected_version": 1},
        headers=handler_headers,
    ).status_code == 403
    assert all(item["visibility"] == "public" for item in client.get(
        f"{url}/history", headers=auth_headers
    ).json()["items"])
    assert any(item["visibility"] == "internal" for item in client.get(
        f"{url}/history", headers=admin_headers
    ).json()["items"])
    incident.status = "closed"
    db_session.flush()
    assert client.post(
        f"{url}/supplements", json={"text": "More details", "expected_version": 1},
        headers=admin_headers,
    ).status_code == 409
    assert admin.id != test_user.id


def test_attachment_upload_list_download_and_scope(
    client, db_session, test_user, auth_headers, tmp_path, monkeypatch
):
    monkeypatch.setattr(get_settings(), "evidence_dir", tmp_path)
    incident = make_incident(db_session, test_user.id, 403)
    other, other_headers = make_user(client, db_session, "reporter")
    url = f"/api/v1/incidents/{incident.id}/attachments"
    upload = client.post(
        url, data={"expected_version": "1"},
        files={"file": ("../evidence.pdf", PDF, "application/pdf")}, headers=auth_headers,
    )
    assert upload.status_code == 201, upload.text
    body = upload.json()
    assert body["original_name"] == "evidence.pdf" and body["incident_version"] == 2
    assert "storage_key" not in body and "url" not in body
    listed = client.get(url, headers=auth_headers)
    assert listed.status_code == 200 and len(listed.json()["items"]) == 1
    assert "storage_key" not in str(listed.json())
    download = client.get(f"{url}/{body['id']}/download", headers=auth_headers)
    assert download.status_code == 200 and download.content == PDF
    assert download.headers["cache-control"] == "no-store"
    assert download.headers["x-content-type-options"] == "nosniff"
    assert "attachment" in download.headers["content-disposition"]
    assert client.get(url, headers=other_headers).status_code == 404
    assert client.get(f"{url}/{body['id']}/download", headers=other_headers).status_code == 404
    assert client.post(
        url, data={"expected_version": "1"},
        files={"file": ("extra.pdf", PDF, "application/pdf")}, headers=auth_headers,
    ).status_code == 409
    assert len(list(tmp_path.iterdir())) == 1
    assert other.id != test_user.id


@pytest.mark.parametrize("name,data,mime", [
    ("fake.pdf", b"not a pdf", "application/pdf"),
    ("wrong.png", PDF, "image/png"),
    ("empty.pdf", b"", "application/pdf"),
    ("huge.pdf", b"%PDF-" + b"x" * (10 * 1024 * 1024), "application/pdf"),
])
def test_invalid_files_leave_no_metadata_or_file(
    client, db_session, test_user, auth_headers, tmp_path, monkeypatch, name, data, mime
):
    monkeypatch.setattr(get_settings(), "evidence_dir", tmp_path)
    incident = make_incident(db_session, test_user.id, 404)
    response = client.post(
        f"/api/v1/incidents/{incident.id}/attachments",
        data={"expected_version": "1"}, files={"file": (name, data, mime)}, headers=auth_headers,
    )
    assert response.status_code == 422
    assert db_session.scalar(select(func.count()).select_from(IncidentAttachment)) == 0
    assert db_session.get(type(incident), incident.id).version == 1
    assert list(tmp_path.iterdir()) == []


def test_upload_failure_cleans_private_file(
    client, db_session, test_user, auth_headers, tmp_path, monkeypatch
):
    monkeypatch.setattr(get_settings(), "evidence_dir", tmp_path)
    incident = make_incident(db_session, test_user.id, 405)
    original_flush = db_session.flush

    def fail_after_file(*args, **kwargs):
        if any(isinstance(item, IncidentAttachment) for item in db_session.new):
            raise RuntimeError("simulated database failure")
        return original_flush(*args, **kwargs)

    monkeypatch.setattr(db_session, "flush", fail_after_file)
    with pytest.raises(RuntimeError, match="simulated"):
        client.post(
            f"/api/v1/incidents/{incident.id}/attachments",
            data={"expected_version": "1"},
            files={"file": ("evidence.pdf", PDF, "application/pdf")}, headers=auth_headers,
        )
    assert list(tmp_path.iterdir()) == []


def test_attachment_limit_and_administrator_scope(
    client, db_session, test_user, tmp_path, monkeypatch
):
    monkeypatch.setattr(get_settings(), "evidence_dir", tmp_path)
    incident = make_incident(db_session, test_user.id, 406)
    _, admin_headers = make_user(client, db_session, "administrator")
    url = f"/api/v1/incidents/{incident.id}/attachments"
    for version in range(1, 6):
        uploaded = client.post(
            url, data={"expected_version": str(version)},
            files={"file": (f"evidence-{version}.pdf", PDF, "application/pdf")},
            headers=admin_headers,
        )
        assert uploaded.status_code == 201, uploaded.text
    full = client.post(
        url, data={"expected_version": "6"},
        files={"file": ("sixth.pdf", PDF, "application/pdf")}, headers=admin_headers,
    )
    assert full.status_code == 409 and full.json()["error"]["code"] == "attachment_limit"
    assert len(list(tmp_path.iterdir())) == 5
    assert len(client.get(url, headers=admin_headers).json()["items"]) == 5
    assert db_session.get(type(incident), incident.id, populate_existing=True).version == 6


def test_failed_supplement_does_not_advance_version_or_leave_history(
    client, db_session, test_user, auth_headers, monkeypatch
):
    incident = make_incident(db_session, test_user.id, 407)
    db_session.commit()
    original_flush = db_session.flush

    def fail_after_supplement(*args, **kwargs):
        if any(isinstance(item, IncidentSupplement) for item in db_session.new):
            raise RuntimeError("simulated history failure")
        return original_flush(*args, **kwargs)

    monkeypatch.setattr(db_session, "flush", fail_after_supplement)
    with pytest.raises(RuntimeError, match="simulated"):
        client.post(
            f"/api/v1/incidents/{incident.id}/supplements",
            json={"text": "New information", "expected_version": 1}, headers=auth_headers,
        )
    assert db_session.get(type(incident), incident.id, populate_existing=True).version == 1
    assert db_session.scalar(select(func.count()).select_from(IncidentSupplement)) == 0
