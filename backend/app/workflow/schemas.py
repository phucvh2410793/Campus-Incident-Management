from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer


class AssignmentIncident(BaseModel):
    """Whitelisted IncidentResponse fields; no comments, audit or file content."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    version: int
    category: str
    title: str
    description: str
    building: str
    location_detail: str | None
    observed_at: datetime | None
    answers: dict
    reporter_id: UUID
    status: str
    triage_required: bool
    severity: str | None
    priority: str | None
    department_id: UUID | None
    assigned_handler_id: UUID | None
    rule_evaluation: dict | None
    reported_at: datetime
    assigned_at: datetime | None
    acknowledged_at: datetime | None
    resolved_at: datetime | None
    closed_at: datetime | None
    acknowledgment_deadline_at: datetime | None
    escalation_level: int

    @field_serializer(
        "observed_at",
        "reported_at",
        "assigned_at",
        "acknowledged_at",
        "resolved_at",
        "closed_at",
        "acknowledgment_deadline_at",
    )
    def utc_timestamp(self, value: datetime | None):
        if value is None:
            return None
        # SQLite test storage loses offsets; application timestamps are UTC.
        return (
            value.replace(tzinfo=value.tzinfo or UTC)
            .astimezone(UTC)
            .isoformat()
            .replace("+00:00", "Z")
        )


class AssignmentResponse(BaseModel):
    incident: AssignmentIncident
    history_id: UUID
