"""Standalone N2 incident request contracts, independent of database and routes."""

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictStr,
    TypeAdapter,
    field_validator,
)


class IncidentAnswers(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)


class WaterLeakAnswers(IncidentAnswers):
    leak_amount: Literal["small", "large", "unknown"]
    near_electricity: Literal["yes", "no", "unknown"]
    slip_risk: StrictBool | None = None


class ElectricalHazardAnswers(IncidentAnswers):
    exposed_wire: Literal["yes", "no", "unknown"]
    smoke_or_sparks: Literal["yes", "no", "unknown"]
    equipment: StrictStr | None = Field(default=None, max_length=200)


class PhishingAnswers(IncidentAnswers):
    interaction: Literal["none", "clicked_link", "entered_information", "unknown"]
    channel: Literal["email", "message", "other"]
    sender_text: StrictStr | None = Field(default=None, max_length=254)


class IncidentFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)

    title: StrictStr = Field(min_length=5, max_length=120)
    description: StrictStr = Field(min_length=20, max_length=2000)
    building: StrictStr = Field(min_length=1, max_length=120)
    location_detail: StrictStr | None = Field(default=None, max_length=200)
    observed_at: StrictStr | None = None

    @field_validator("observed_at")
    @classmethod
    def utc_timestamp_not_in_future(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.endswith("Z"):
            raise ValueError("must be an ISO 8601 UTC timestamp ending in Z")
        try:
            observed_at = datetime.fromisoformat(value[:-1] + "+00:00")
        except ValueError as exc:
            raise ValueError("must be a valid ISO 8601 UTC timestamp") from exc
        if observed_at > datetime.now(UTC):
            raise ValueError("must not be in the future")
        return value


class WaterLeakIncidentCreate(IncidentFields):
    category: Literal["water_leak"]
    answers: WaterLeakAnswers


class ElectricalHazardIncidentCreate(IncidentFields):
    category: Literal["electrical_hazard"]
    answers: ElectricalHazardAnswers


class PhishingIncidentCreate(IncidentFields):
    category: Literal["phishing"]
    answers: PhishingAnswers


IncidentCreateRequest = Annotated[
    WaterLeakIncidentCreate | ElectricalHazardIncidentCreate | PhishingIncidentCreate,
    Field(discriminator="category"),
]

_INCIDENT_CREATE_ADAPTER = TypeAdapter(IncidentCreateRequest)


def validate_incident_create(payload: object) -> IncidentCreateRequest:
    """Validate a create request without touching auth, database, or API routes."""
    return _INCIDENT_CREATE_ADAPTER.validate_python(payload)
