"""Standalone W1 contracts, independent of authentication and incident models."""

from enum import StrEnum
from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Status(StrEnum):
    REPORTED = "reported"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


class Request(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_version: int = Field(strict=True, ge=1)


class AssignRequest(Request):
    department_id: UUID
    handler_id: UUID | None
    reason: str = Field(min_length=1)


class AcknowledgeRequest(Request):
    pass


class TransitionRequest(Request):
    target_status: Status
    reason: str | None = None
    resolution: str | None = None


class DispositionRequest(Request):
    kind: str
    reason: str = Field(min_length=1)
    duplicate_of_id: UUID | None = None

    @field_validator("kind")
    @classmethod
    def valid_kind(cls, value: str) -> str:
        if value not in {"duplicate", "invalid"}:
            raise ValueError("kind must be duplicate or invalid")
        return value

    @model_validator(mode="after")
    def duplicate_requires_original(self) -> Self:
        if self.kind == "duplicate" and self.duplicate_of_id is None:
            raise ValueError("duplicate_of_id is required for duplicate")
        return self


class WorkflowViolation(ValueError):
    def __init__(self, code: str, http_status: int):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


# Explicit endpoint boundaries: assign/acknowledge are not generic transitions.
TRANSITIONS = {
    (Status.IN_PROGRESS, Status.RESOLVED): ("handler", "department_manager", "administrator"),
    (Status.RESOLVED, Status.CLOSED): ("department_manager", "administrator"),
    (Status.RESOLVED, Status.IN_PROGRESS): ("department_manager", "administrator"),
    (Status.CLOSED, Status.IN_PROGRESS): ("department_manager", "administrator"),
}


def validate_transition(current: Status, role: str, request: TransitionRequest) -> None:
    """Validate an already authorized incident; N1 must check record scope first.

    This pure function does not provide atomic version checks or write timestamps.
    Those belong in the future repository transaction.
    """
    if role not in {"handler", "department_manager", "administrator"}:
        raise WorkflowViolation("forbidden", 403)
    roles = TRANSITIONS.get((current, request.target_status))
    if roles is None:
        raise WorkflowViolation("invalid_transition", 409)
    if role not in roles:
        raise WorkflowViolation("forbidden", 403)
    if request.target_status == Status.RESOLVED and not request.resolution:
        raise WorkflowViolation("validation_error", 422)
    if request.target_status == Status.IN_PROGRESS and not request.reason:
        raise WorkflowViolation("validation_error", 422)
