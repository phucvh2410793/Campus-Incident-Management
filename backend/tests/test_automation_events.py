import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.automation.fixtures import (
    SAMPLE_INCIDENT_ID,
    SAMPLE_REQUEST_ID,
    SAMPLE_WEBHOOK_SECRET,
    get_fixture_assigned_event,
    get_fixture_priority_changed_event,
    get_fixture_reported_event,
    get_fixture_sla_escalated_event,
    get_invalid_event_payloads,
)
from app.automation.publisher import (
    IdempotencyConflictError,
    InMemoryEventPublisher,
)
from app.automation.schemas import EventEnvelope, EventType
from app.automation.security import (
    build_webhook_headers,
    calculate_signature,
    verify_webhook_request,
)


def test_fixture_reported_event_matches_contract():
    event = get_fixture_reported_event()
    assert event.event_type == EventType.INCIDENT_REPORTED
    assert event.schema_version == 1
    assert str(event.incident_id) == "2ee24992-34d3-4955-9e5c-f7446fd42393"

    payload_json = event.model_dump_json()
    data = json.loads(payload_json)

    assert data["event_type"] == "incident.reported"
    assert data["schema_version"] == 1
    assert data["occurred_at"] == "2026-11-02T09:30:00Z"
    assert "description" not in data  # Sensitive fields must not exist


def test_all_fixture_event_types():
    events = [
        get_fixture_reported_event(),
        get_fixture_assigned_event(),
        get_fixture_priority_changed_event(),
        get_fixture_sla_escalated_event(),
    ]
    expected_types = [
        EventType.INCIDENT_REPORTED,
        EventType.INCIDENT_ASSIGNED,
        EventType.INCIDENT_PRIORITY_CHANGED,
        EventType.SLA_ESCALATED,
    ]
    for ev, expected in zip(events, expected_types, strict=True):
        assert ev.event_type == expected
        assert isinstance(ev.event_id, uuid.UUID)
        assert ev.schema_version == 1


def test_envelope_forbids_extra_sensitive_fields():
    with pytest.raises(ValidationError) as exc:
        EventEnvelope(
            event_id=uuid.uuid4(),
            event_type=EventType.INCIDENT_REPORTED,
            incident_id=SAMPLE_INCIDENT_ID,
            request_id=SAMPLE_REQUEST_ID,
            forbidden_extra_field="sensitive details",  # type: ignore[call-arg]
        )
    assert "extra_forbidden" in str(exc.value)


def test_invalid_payloads_rejected():
    invalid_payloads = get_invalid_event_payloads()
    for payload in invalid_payloads:
        with pytest.raises(ValidationError):
            EventEnvelope.model_validate(payload)


def test_hmac_signature_calculation():
    ts = 1730539800
    raw_body = '{"event_id":"d69996e8-ae76-44d4-a396-41694498feb3"}'
    secret = "my-secret-key"

    sig = calculate_signature(ts, raw_body, secret)
    assert sig.startswith("sha256=")
    # Deterministic recalculation must produce identical signature
    assert sig == calculate_signature(ts, raw_body, secret)


def test_webhook_headers_and_verification_success():
    event = get_fixture_reported_event()
    raw_body = event.model_dump_json()
    secret = SAMPLE_WEBHOOK_SECRET
    ts = 1730539800

    headers = build_webhook_headers(event.event_id, raw_body, secret, timestamp=ts)
    assert headers["X-CIM-Event-ID"] == str(event.event_id)
    assert headers["X-CIM-Timestamp"] == str(ts)
    assert headers["X-CIM-Signature"].startswith("sha256=")

    # Verify with matching current_time
    result = verify_webhook_request(headers, raw_body, secret, current_time=ts + 10)
    assert result.is_valid is True
    assert result.event_id == event.event_id
    assert result.timestamp == ts
    assert result.error_code is None


def test_webhook_verification_rejects_tampered_body():
    event = get_fixture_reported_event()
    raw_body = event.model_dump_json()
    secret = SAMPLE_WEBHOOK_SECRET
    ts = 1730539800

    headers = build_webhook_headers(event.event_id, raw_body, secret, timestamp=ts)

    # Tamper with raw body
    tampered_body = raw_body.replace("incident.reported", "incident.assigned")
    result = verify_webhook_request(headers, tampered_body, secret, current_time=ts)
    assert result.is_valid is False
    assert result.error_code == "invalid_signature"


def test_webhook_verification_rejects_wrong_secret():
    event = get_fixture_reported_event()
    raw_body = event.model_dump_json()
    ts = 1730539800

    headers = build_webhook_headers(event.event_id, raw_body, "correct-secret", timestamp=ts)
    result = verify_webhook_request(headers, raw_body, "wrong-secret", current_time=ts)
    assert result.is_valid is False
    assert result.error_code == "invalid_signature"


def test_webhook_verification_rejects_expired_timestamp():
    event = get_fixture_reported_event()
    raw_body = event.model_dump_json()
    secret = SAMPLE_WEBHOOK_SECRET
    ts = 1730539800

    headers = build_webhook_headers(event.event_id, raw_body, secret, timestamp=ts)
    # Delivered 350 seconds later (> 300s tolerance)
    result = verify_webhook_request(headers, raw_body, secret, current_time=ts + 350)
    assert result.is_valid is False
    assert result.error_code == "expired_timestamp"


def test_webhook_verification_rejects_future_timestamp():
    event = get_fixture_reported_event()
    raw_body = event.model_dump_json()
    secret = SAMPLE_WEBHOOK_SECRET
    ts = 1730539800

    headers = build_webhook_headers(event.event_id, raw_body, secret, timestamp=ts)
    # Current time is 350s before timestamp (drift > 300s into future)
    result = verify_webhook_request(headers, raw_body, secret, current_time=ts - 350)
    assert result.is_valid is False
    assert result.error_code == "future_timestamp"


def test_webhook_verification_rejects_missing_headers():
    result = verify_webhook_request({}, "{}", "secret")
    assert result.is_valid is False
    assert result.error_code == "missing_headers"


def test_event_publisher_port():
    publisher = InMemoryEventPublisher()
    assert len(publisher) == 0

    event1 = publisher.create_and_publish(
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    assert len(publisher) == 1
    assert publisher.get_event_by_id(event1.event_id) == event1

    # Publish another event
    publisher.create_and_publish(
        event_type=EventType.INCIDENT_ASSIGNED,
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
    )
    assert len(publisher) == 2
    assert len(publisher.filter_by_type(EventType.INCIDENT_REPORTED)) == 1
    assert len(publisher.filter_by_type(EventType.INCIDENT_ASSIGNED)) == 1


def test_event_publisher_idempotency():
    publisher = InMemoryEventPublisher()
    event = get_fixture_reported_event()

    # Publishing the exact same event twice must succeed idempotently
    publisher.publish(event)
    assert len(publisher) == 1
    publisher.publish(event)
    assert len(publisher) == 1

    # Publishing an event with the same ID but conflicting payload must raise IdempotencyConflictError
    conflicting_event = EventEnvelope(
        event_id=event.event_id,  # Same event_id
        event_type=EventType.INCIDENT_ASSIGNED,  # Different type!
        incident_id=SAMPLE_INCIDENT_ID,
        request_id=SAMPLE_REQUEST_ID,
        occurred_at=datetime.now(timezone.utc),
    )
    with pytest.raises(IdempotencyConflictError):
        publisher.publish(conflicting_event)


def test_json_fixtures_match_schema():
    fixtures_dir = Path(__file__).resolve().parent.parent.parent / "workflows" / "events"
    json_files = ["incident_reported.json", "incident_assigned.json", "incident_priority_changed.json", "sla_escalated.json"]

    for file_name in json_files:
        path = fixtures_dir / file_name
        assert path.exists(), f"File {file_name} must exist"
        data = json.loads(path.read_text(encoding="utf-8"))
        envelope = EventEnvelope.model_validate(data)
        assert envelope.schema_version == 1
