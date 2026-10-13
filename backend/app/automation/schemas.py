import uuid
from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


class EventType(str, Enum):
    """Event types supported by CIM event envelope (docs/api-contract.md section 6)."""

    INCIDENT_REPORTED = "incident.reported"
    INCIDENT_ASSIGNED = "incident.assigned"
    INCIDENT_PRIORITY_CHANGED = "incident.priority_changed"
    SLA_ESCALATED = "sla.escalated"


class EventEnvelope(BaseModel):
    """Strict Event Envelope schema for dispatcher <-> n8n webhook communication.

    Contract rules:
    - Extra fields are strictly forbidden to ensure sensitive data (evidence, descriptions,
      internal comments, raw secrets) cannot leak into event payloads.
    - Timestamps are formatted as ISO 8601 UTC with trailing 'Z'.
    - event_id, incident_id, and request_id must be valid UUIDs.
    """

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )

    event_id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        description="Unique event ID serving as idempotency key.",
    )
    event_type: EventType = Field(
        description="Domain event type.",
    )
    incident_id: uuid.UUID = Field(
        description="ID of the related incident.",
    )
    occurred_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Event creation timestamp in UTC.",
    )
    schema_version: int = Field(
        default=1,
        ge=1,
        description="Schema version of this event contract.",
    )
    request_id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        description="Correlation request ID matching X-Request-ID.",
    )

    @field_validator("occurred_at")
    @classmethod
    def ensure_utc(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)

    @field_serializer("occurred_at")
    def serialize_datetime(self, dt: datetime) -> str:
        # Standardize to format 2026-11-02T09:30:00Z
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    @field_serializer("event_id", "incident_id", "request_id")
    def serialize_uuid(self, u: uuid.UUID) -> str:
        return str(u)
