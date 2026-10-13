import uuid
from datetime import datetime, timezone
from typing import Any

from app.automation.schemas import EventEnvelope, EventType

SAMPLE_WEBHOOK_SECRET = "test-webhook-hmac-secret-k39x9v1z"

# Deterministic UUIDs for reproducibility across tests and documentation
SAMPLE_INCIDENT_ID = uuid.UUID("2ee24992-34d3-4955-9e5c-f7446fd42393")
SAMPLE_EVENT_REPORTED_ID = uuid.UUID("d69996e8-ae76-44d4-a396-41694498feb3")
SAMPLE_EVENT_ASSIGNED_ID = uuid.UUID("a1112222-3333-4444-5555-666677778888")
SAMPLE_EVENT_PRIORITY_ID = uuid.UUID("b2223333-4444-5555-6666-777788889999")
SAMPLE_EVENT_ESCALATED_ID = uuid.UUID("c3334444-5555-6666-7777-888899990000")
SAMPLE_REQUEST_ID = uuid.UUID("9c23fa93-756a-45c7-805b-96d9094b908d")

SAMPLE_TIMESTAMP_UTC = datetime(2026, 11, 2, 9, 30, 0, tzinfo=timezone.utc)


def get_fixture_reported_event() -> EventEnvelope:
    """Standard fixture for incident.reported matching docs/api-contract.md section 6."""
    return EventEnvelope(
        event_id=SAMPLE_EVENT_REPORTED_ID,
        event_type=EventType.INCIDENT_REPORTED,
        incident_id=SAMPLE_INCIDENT_ID,
        occurred_at=SAMPLE_TIMESTAMP_UTC,
        schema_version=1,
        request_id=SAMPLE_REQUEST_ID,
    )


def get_fixture_assigned_event() -> EventEnvelope:
    """Standard fixture for incident.assigned."""
    return EventEnvelope(
        event_id=SAMPLE_EVENT_ASSIGNED_ID,
        event_type=EventType.INCIDENT_ASSIGNED,
        incident_id=SAMPLE_INCIDENT_ID,
        occurred_at=datetime(2026, 11, 2, 9, 35, 0, tzinfo=timezone.utc),
        schema_version=1,
        request_id=SAMPLE_REQUEST_ID,
    )


def get_fixture_priority_changed_event() -> EventEnvelope:
    """Standard fixture for incident.priority_changed."""
    return EventEnvelope(
        event_id=SAMPLE_EVENT_PRIORITY_ID,
        event_type=EventType.INCIDENT_PRIORITY_CHANGED,
        incident_id=SAMPLE_INCIDENT_ID,
        occurred_at=datetime(2026, 11, 2, 9, 40, 0, tzinfo=timezone.utc),
        schema_version=1,
        request_id=SAMPLE_REQUEST_ID,
    )


def get_fixture_sla_escalated_event() -> EventEnvelope:
    """Standard fixture for sla.escalated."""
    return EventEnvelope(
        event_id=SAMPLE_EVENT_ESCALATED_ID,
        event_type=EventType.SLA_ESCALATED,
        incident_id=SAMPLE_INCIDENT_ID,
        occurred_at=datetime(2026, 11, 2, 9, 45, 0, tzinfo=timezone.utc),
        schema_version=1,
        request_id=SAMPLE_REQUEST_ID,
    )


def get_invalid_event_payloads() -> list[dict[str, Any]]:
    """Collection of invalid payloads for negative testing."""
    return [
        # Case 1: Missing mandatory incident_id
        {
            "event_id": str(uuid.uuid4()),
            "event_type": "incident.reported",
            "occurred_at": "2026-11-02T09:30:00Z",
            "schema_version": 1,
            "request_id": str(uuid.uuid4()),
        },
        # Case 2: Unknown/unsupported event type
        {
            "event_id": str(uuid.uuid4()),
            "event_type": "incident.deleted_unsupported",
            "incident_id": str(SAMPLE_INCIDENT_ID),
            "occurred_at": "2026-11-02T09:30:00Z",
            "schema_version": 1,
            "request_id": str(uuid.uuid4()),
        },
        # Case 3: Invalid UUID string format
        {
            "event_id": "not-a-valid-uuid",
            "event_type": "incident.reported",
            "incident_id": str(SAMPLE_INCIDENT_ID),
            "occurred_at": "2026-11-02T09:30:00Z",
            "schema_version": 1,
            "request_id": str(uuid.uuid4()),
        },
        # Case 4: Extra forbidden fields (preventing sensitive data leakage in envelope)
        {
            "event_id": str(uuid.uuid4()),
            "event_type": "incident.reported",
            "incident_id": str(SAMPLE_INCIDENT_ID),
            "occurred_at": "2026-11-02T09:30:00Z",
            "schema_version": 1,
            "request_id": str(uuid.uuid4()),
            "sensitive_description": "Leak of user description or password",
        },
    ]
