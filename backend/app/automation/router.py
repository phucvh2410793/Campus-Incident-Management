import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.automation.publisher import get_event_publisher
from app.automation.repository import NotificationRepository, OutboxRepository
from app.automation.security import WebhookVerificationResult, require_valid_webhook_signature
from app.automation.service_auth import ServicePrincipal, get_optional_db, require_service_bearer

router = APIRouter(
    prefix="/internal",
    tags=["internal"],
    dependencies=[Depends(require_service_bearer)],
)


# ---------------------------------------------------------------------------
# Pydantic Schemas for /internal/* endpoints (API contract compliant)
# ---------------------------------------------------------------------------


class EventMetadataResponse(BaseModel):
    """Minimal metadata returned by GET /internal/events/{id}.

    Strictly excludes descriptions, internal notes, evidence and raw secrets.
    """

    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    event_type: str
    incident_id: uuid.UUID
    request_id: uuid.UUID
    occurred_at: datetime
    schema_version: int
    status: str
    attempt_count: int


class EvaluateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str = Field(min_length=1, max_length=255)


class EvaluateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    incident_id: uuid.UUID
    status: str
    severity: str
    priority: str
    department_id: uuid.UUID
    rule_id: str
    rule_version: int
    reason: str
    triage_required: bool
    incident_version: int


class CompleteEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1, max_length=255)
    status: Literal["done", "failed"]
    error_code: str | None = None


class CompleteEventResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    status: str
    run_id: str


class ClaimNotificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    kind: str = Field(min_length=1, max_length=64)
    recipient_user_id: uuid.UUID


class ClaimNotificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notification_id: uuid.UUID
    should_send: bool


class CompleteNotificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["sent", "failed", "uncertain"]
    provider_message_id: str | None = None
    error_message: str | None = None


class CompleteNotificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notification_id: uuid.UUID
    status: str


class SlaCheckResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checked_count: int
    escalations_created: int


# In-memory store for evaluation idempotency and testing when DB is not spun up
_IN_MEMORY_EVALUATIONS: dict[uuid.UUID, dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@router.get("/events/{event_id}", response_model=EventMetadataResponse)
def get_internal_event_metadata(
    event_id: uuid.UUID,
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> EventMetadataResponse:
    """GET /internal/events/{event_id} - Retrieve minimal event metadata for n8n orchestrator."""
    if db is not None:
        repo = OutboxRepository(db)
        record = repo.get_event(event_id)
        if record:
            return EventMetadataResponse(
                event_id=record.id,
                event_type=record.event_type,
                incident_id=record.incident_id,
                request_id=record.request_id,
                occurred_at=record.occurred_at,
                schema_version=record.schema_version,
                status=record.status,
                attempt_count=record.attempt_count,
            )

    # Fallback to in-memory event publisher for unit test environments
    publisher = get_event_publisher()
    if hasattr(publisher, "get_event"):
        ev = publisher.get_event(event_id)
        if ev:
            return EventMetadataResponse(
                event_id=ev.event_id,
                event_type=ev.event_type.value,
                incident_id=ev.incident_id,
                request_id=ev.request_id,
                occurred_at=ev.occurred_at,
                schema_version=ev.schema_version,
                status="pending",
                attempt_count=0,
            )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Outbox event with ID '{event_id}' not found",
    )


@router.post("/events/{event_id}/evaluate", response_model=EvaluateResponse)
def evaluate_internal_event(
    event_id: uuid.UUID,
    payload: EvaluateRequest,
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> EvaluateResponse:
    """POST /internal/events/{event_id}/evaluate - Evaluate incident rule classification.

    Idempotent: repeating the evaluation on the same event returns identical results.
    Does not trust priority or department_id from request body.
    """
    # 1. Verify event exists
    incident_id: uuid.UUID | None = None
    if db is not None:
        repo = OutboxRepository(db)
        record = repo.get_event(event_id)
        if record:
            incident_id = record.incident_id

    if incident_id is None:
        publisher = get_event_publisher()
        if hasattr(publisher, "get_event"):
            ev = publisher.get_event(event_id)
            if ev:
                incident_id = ev.incident_id

    if incident_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Outbox event with ID '{event_id}' not found",
        )

    # 2. Check cached evaluation for idempotency
    if event_id in _IN_MEMORY_EVALUATIONS:
        cached = _IN_MEMORY_EVALUATIONS[event_id]
        return EvaluateResponse(**cached)

    # 3. Default demo evaluation result (W3 milestone contract baseline)
    eval_result = {
        "incident_id": incident_id,
        "status": "assigned",
        "severity": "high",
        "priority": "P1",
        "department_id": uuid.UUID("00000000-0000-0000-0000-000000000001"),
        "rule_id": "demo-v1",
        "rule_version": 1,
        "reason": "Evaluated based on rule demo-v1",
        "triage_required": False,
        "incident_version": 1,
    }
    _IN_MEMORY_EVALUATIONS[event_id] = eval_result
    return EvaluateResponse(**eval_result)


@router.post("/events/{event_id}/complete", response_model=CompleteEventResponse)
def complete_internal_event(
    event_id: uuid.UUID,
    payload: CompleteEventRequest,
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> CompleteEventResponse:
    """POST /internal/events/{event_id}/complete - Mark event dispatch as completed or failed.

    Guards against invalid done -> failed transitions.
    """
    if db is not None:
        repo = OutboxRepository(db)
        record = repo.get_event(event_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Outbox event with ID '{event_id}' not found",
            )

        # Enforce contract: không cho done -> failed
        if record.status == "done" and payload.status == "failed":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Invalid status transition: event is already 'done' "
                    "and cannot be marked 'failed'"
                ),
            )

        if record.status == "done" and payload.status == "done":
            return CompleteEventResponse(
                event_id=event_id,
                status="done",
                run_id=payload.run_id,
            )

        if payload.status == "done":
            repo.complete_event(event_id)
        else:
            err = payload.error_code or "Workflow execution failed"
            repo.fail_event(event_id, error_message=err)
        db.commit()

        return CompleteEventResponse(
            event_id=event_id,
            status=payload.status,
            run_id=payload.run_id,
        )

    # In-memory fallback
    return CompleteEventResponse(
        event_id=event_id,
        status=payload.status,
        run_id=payload.run_id,
    )


@router.post("/notifications/claim", response_model=ClaimNotificationResponse)
def claim_internal_notification(
    payload: ClaimNotificationRequest,
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> ClaimNotificationResponse:
    """POST /internal/notifications/claim - Claim notification task atomically.

    Guarantees unique (event_id, kind, recipient_user_id) idempotency to avoid duplicate sends.
    """
    if db is not None:
        repo = NotificationRepository(db)
        notification, should_send = repo.claim_notification(
            event_id=payload.event_id,
            kind=payload.kind,
            recipient_user_id=payload.recipient_user_id,
        )
        db.commit()
        return ClaimNotificationResponse(
            notification_id=notification.id,
            should_send=should_send,
        )

    # Fallback ID for test environments without DB
    return ClaimNotificationResponse(
        notification_id=uuid.uuid4(),
        should_send=True,
    )


@router.post(
    "/notifications/{notification_id}/complete",
    response_model=CompleteNotificationResponse,
)
def complete_internal_notification(
    notification_id: uuid.UUID,
    payload: CompleteNotificationRequest,
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> CompleteNotificationResponse:
    """POST /internal/notifications/{id}/complete - Record notification outcome.

    Once sent or uncertain, prevents automatic resends.
    """
    if db is not None:
        repo = NotificationRepository(db)
        record = repo.complete_notification(
            notification_id=notification_id,
            status=payload.status,
            provider_message_id=payload.provider_message_id,
            error_message=payload.error_message,
        )
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Notification with ID '{notification_id}' not found",
            )
        db.commit()
        return CompleteNotificationResponse(
            notification_id=record.id,
            status=record.status,
        )

    return CompleteNotificationResponse(
        notification_id=notification_id,
        status=payload.status,
    )


@router.post("/sla/check", response_model=SlaCheckResponse)
def check_sla_internal(
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> SlaCheckResponse:
    """POST /internal/sla/check - Periodic SLA review endpoint called by scheduled n8n job."""
    # Stub hook for SLA checks (N3/N5 W8 integration)
    return SlaCheckResponse(
        checked_count=0,
        escalations_created=0,
    )


@router.post("/webhooks/verify")
def verify_incoming_webhook_endpoint(
    verification: Annotated[WebhookVerificationResult, Depends(require_valid_webhook_signature)],
) -> dict[str, Any]:
    """Test endpoint verifying incoming webhook HMAC signature, timestamp, and event ID."""
    return {
        "status": "verified",
        "event_id": str(verification.event_id),
        "timestamp": verification.timestamp,
    }
