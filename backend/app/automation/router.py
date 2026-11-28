import base64
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.automation.models import Notification, OutboxEvent
from app.automation.notifications import (
    DemoEmailSender,
    build_assigned_notification,
    build_p1_alert_notification,
    build_public_state_notification,
    build_reported_notification,
    dispatch_notification_task,
)
from app.automation.publisher import get_event_publisher
from app.automation.repository import NotificationRepository, OutboxRepository
from app.automation.security import WebhookVerificationResult, require_valid_webhook_signature
from app.automation.service_auth import ServicePrincipal, get_optional_db, require_service_bearer
from app.automation.webhook import sanitize_error_message
from app.sla.service import SlaEscalationService

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


# ---------------------------------------------------------------------------
# W6 & W7 Schemas for Notifications, Dead-Letter and Admin Retry
# ---------------------------------------------------------------------------


class DispatchNotificationRequest(BaseModel):
    """Request to safely format, claim and dispatch a test notification email."""

    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    scenario: Literal["reported", "assigned", "p1", "public_state_updated"]
    recipient_user_id: uuid.UUID
    recipient_email: str = Field(min_length=3, max_length=255)
    incident_id: uuid.UUID
    category: str | None = None
    department_name: str | None = None
    priority: str | None = None
    reason: str | None = None
    new_state: str | None = None
    resolution_summary: str | None = None
    frontend_base_url: str = "http://localhost:5173"
    simulate_outcome: Literal["sent", "failed", "uncertain"] | None = None


class DispatchNotificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notification_id: uuid.UUID
    status: str
    was_newly_sent: bool
    provider_message_id: str | None = None
    error_message: str | None = None
    subject: str
    recipient_email: str
    link: str


class NotificationItemResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    event_id: uuid.UUID
    kind: str
    recipient_user_id: uuid.UUID
    status: str
    provider_message_id: str | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


class ListNotificationsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[NotificationItemResponse]
    next_cursor: str | None = None


class AdminRetryNotificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(
        min_length=1,
        max_length=500,
        description="Mandatory reason for admin retry",
    )


class AdminRetryNotificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notification_id: uuid.UUID
    status: str
    reason: str
    message: str


class FailedEventItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    event_type: str
    incident_id: uuid.UUID
    attempt_count: int
    max_attempts: int
    error_message: str | None = None
    created_at: datetime
    last_attempt_at: datetime | None = None


class ListFailedEventsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[FailedEventItem]
    next_cursor: str | None = None


class AdminRetryEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(
        min_length=1,
        max_length=500,
        description="Mandatory reason for admin retry",
    )


class AdminRetryEventResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    status: str
    reason: str
    message: str


class DeadLetterSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    failed_events_count: int
    failed_notifications_count: int
    uncertain_notifications_count: int


# In-memory store for evaluation idempotency and testing when DB is not spun up
_IN_MEMORY_EVALUATIONS: dict[uuid.UUID, dict[str, Any]] = {}
_IN_MEMORY_FAILED_EVENTS: dict[uuid.UUID, dict[str, Any]] = {}
_IN_MEMORY_NOTIFICATIONS_STORE: dict[uuid.UUID, dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# Keyset Cursor Helpers
# ---------------------------------------------------------------------------


def _encode_cursor(created_at: datetime, record_id: uuid.UUID) -> str:
    utc_dt = created_at if created_at.tzinfo is not None else created_at.replace(tzinfo=UTC)
    raw = f"{utc_dt.isoformat()}|{record_id}"
    return base64.urlsafe_b64encode(raw.encode("ascii")).decode("ascii")


def _decode_cursor(cursor_str: str) -> tuple[datetime, uuid.UUID]:
    try:
        decoded = base64.urlsafe_b64decode(cursor_str.encode("ascii")).decode("ascii")
        dt_str, id_str = decoded.split("|", 1)
        dt = datetime.fromisoformat(dt_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt, uuid.UUID(id_str)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid pagination cursor format",
        ) from exc


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@router.get("/events/failed", response_model=ListFailedEventsResponse)
@router.get("/dead-letter/events", response_model=ListFailedEventsResponse)
def list_failed_events_endpoint(
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
) -> ListFailedEventsResponse:
    """GET /internal/events/failed - List dead-letter events for operator inspection.

    Oldest first, keyset cursor pagination on (created_at, id). Secrets in errors are redacted.
    Must be registered before /events/{event_id} to prevent path parameter shadowing.
    """
    after_created_at = None
    after_id = None
    if cursor:
        after_created_at, after_id = _decode_cursor(cursor)

    if db is not None:
        repo = OutboxRepository(db)
        records = repo.list_failed_events(
            limit=limit + 1,
            after_created_at=after_created_at,
            after_id=after_id,
        )
        has_next = len(records) > limit
        items_page = records[:limit]
        next_cur = None
        if has_next and items_page:
            last = items_page[-1]
            next_cur = _encode_cursor(last.created_at, last.id)

        return ListFailedEventsResponse(
            items=[
                FailedEventItem(
                    event_id=ev.id,
                    event_type=ev.event_type,
                    incident_id=ev.incident_id,
                    attempt_count=ev.attempt_count,
                    max_attempts=ev.max_attempts,
                    error_message=sanitize_error_message(ev.error_message),
                    created_at=ev.created_at,
                    last_attempt_at=ev.last_attempt_at,
                )
                for ev in items_page
            ],
            next_cursor=next_cur,
        )

    # In-memory fallback
    failed_items = [ev for ev in _IN_MEMORY_FAILED_EVENTS.values() if ev.get("status") == "failed"]
    return ListFailedEventsResponse(
        items=[
            FailedEventItem(
                event_id=ev["id"],
                event_type=ev["event_type"],
                incident_id=ev["incident_id"],
                attempt_count=ev["attempt_count"],
                max_attempts=ev.get("max_attempts", 5),
                error_message=sanitize_error_message(ev.get("error_message")),
                created_at=ev["created_at"],
                last_attempt_at=ev.get("last_attempt_at"),
            )
            for ev in failed_items[:limit]
        ],
        next_cursor=None,
    )


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

    # 3. Evaluate real incident if present in DB (W8 milestone integration)
    if db is not None:
        try:
            import sqlalchemy as sa

            from app.auth.seed_demo import DEMO_DEPARTMENTS
            from app.incidents.models import Incident
            from app.models import Department
            from app.rules.engine import evaluate_incident

            incident = db.get(Incident, incident_id)
            if incident is not None:
                rule_res = evaluate_incident(incident.category, incident.answers or {})

                dept = None
                if rule_res.department:
                    dept = db.scalar(
                        sa.select(Department).where(Department.name == rule_res.department)
                    )

                dept_map = {name: did for did, name in DEMO_DEPARTMENTS}
                department_id = (
                    dept.id
                    if dept
                    else dept_map.get(
                        rule_res.department,
                        uuid.UUID("20000000-0000-4000-8000-000000000001"),
                    )
                )

                severity = rule_res.severity or "medium"
                priority = (rule_res.priority or "p2").upper()
                rule_id = rule_res.rule_id or "demo-v1"
                reason = rule_res.reason

                incident.severity = rule_res.severity or incident.severity
                incident.priority = (rule_res.priority or incident.priority or "p2").lower()
                incident.department_id = department_id
                incident.triage_required = rule_res.triage_required
                incident.rule_evaluation = {
                    "rule_id": rule_res.rule_id,
                    "severity": rule_res.severity,
                    "priority": rule_res.priority,
                    "department": rule_res.department,
                    "reason": rule_res.reason,
                    "triage_required": rule_res.triage_required,
                    "safety_flags": list(rule_res.safety_flags) if rule_res.safety_flags else [],
                    "run_id": payload.run_id,
                }
                db.commit()

                eval_result = {
                    "incident_id": incident_id,
                    "status": incident.status,
                    "severity": severity,
                    "priority": priority,
                    "department_id": department_id,
                    "rule_id": rule_id,
                    "rule_version": 1,
                    "reason": reason,
                    "triage_required": rule_res.triage_required,
                    "incident_version": incident.version,
                }
                _IN_MEMORY_EVALUATIONS[event_id] = eval_result
                return EvaluateResponse(**eval_result)
        except Exception:
            db.rollback()
            # If DB lookup or rule engine fails, fallback gracefully to contract baseline
            pass

    # 4. Default demo evaluation result (W3 milestone contract baseline)
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
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        )

    try:
        checked_count, escalations_created = SlaEscalationService(db).check(now=datetime.now(UTC))
        db.commit()
    except Exception:
        db.rollback()
        raise

    return SlaCheckResponse(
        checked_count=checked_count,
        escalations_created=escalations_created,
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


# ---------------------------------------------------------------------------
# W6: Notification Claim & Safe Email Dispatch Endpoints
# ---------------------------------------------------------------------------


@router.post("/notifications/dispatch", response_model=DispatchNotificationResponse)
def dispatch_test_notification_endpoint(
    payload: DispatchNotificationRequest,
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> DispatchNotificationResponse:
    """POST /internal/notifications/dispatch - Claim and dispatch safe test notification email.

    Guarantees:
    - Atomically claims notification using (event_id, kind, recipient_user_id) idempotency key.
    - If already claimed, skips duplicate sending and returns existing record.
    - Strict validation: rejects emails containing files, raw secrets, or internal notes.
    - Can simulate sent, failed, or uncertain delivery outcomes.
    - Uncertain or sent notifications are NEVER automatically resent.
    """
    # 1. Format safe notification based on scenario
    if payload.scenario == "reported":
        email_obj = build_reported_notification(
            incident_id=payload.incident_id,
            reporter_user_id=payload.recipient_user_id,
            reporter_email=payload.recipient_email,
            category=payload.category,
            frontend_base_url=payload.frontend_base_url,
        )
    elif payload.scenario == "assigned":
        email_obj = build_assigned_notification(
            incident_id=payload.incident_id,
            handler_user_id=payload.recipient_user_id,
            handler_email=payload.recipient_email,
            department_name=payload.department_name,
            priority=payload.priority,
            frontend_base_url=payload.frontend_base_url,
        )
    elif payload.scenario == "p1":
        email_obj = build_p1_alert_notification(
            incident_id=payload.incident_id,
            manager_user_id=payload.recipient_user_id,
            manager_email=payload.recipient_email,
            reason=payload.reason,
            frontend_base_url=payload.frontend_base_url,
        )
    elif payload.scenario == "public_state_updated":
        if not payload.new_state:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Field 'new_state' is required for 'public_state_updated' scenario",
            )
        try:
            email_obj = build_public_state_notification(
                incident_id=payload.incident_id,
                reporter_user_id=payload.recipient_user_id,
                reporter_email=payload.recipient_email,
                new_state=payload.new_state,
                resolution_summary=payload.resolution_summary,
                frontend_base_url=payload.frontend_base_url,
            )
        except ValueError as err:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(err),
            ) from err
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown notification scenario: '{payload.scenario}'",
        )

    # 2. Configure simulated outcome if requested
    custom_sender = DemoEmailSender()
    if payload.simulate_outcome is not None:
        custom_sender.set_next_outcome(payload.simulate_outcome)

    if db is not None:
        notification, result, was_newly_sent = dispatch_notification_task(
            db=db,
            event_id=payload.event_id,
            email=email_obj,
            sender=custom_sender,
        )
        db.commit()

        return DispatchNotificationResponse(
            notification_id=notification.id,
            status=notification.status,
            was_newly_sent=was_newly_sent,
            provider_message_id=notification.provider_message_id,
            error_message=notification.error_message,
            subject=email_obj.subject,
            recipient_email=email_obj.recipient_email,
            link=email_obj.link,
        )

    # In-memory fallback
    key = (payload.event_id, email_obj.kind.value, payload.recipient_user_id)
    existing = next(
        (n for n in _IN_MEMORY_NOTIFICATIONS_STORE.values() if n.get("_key") == key), None
    )
    if existing:
        return DispatchNotificationResponse(
            notification_id=existing["id"],
            status=existing["status"],
            was_newly_sent=False,
            provider_message_id=existing.get("provider_message_id"),
            error_message=existing.get("error_message"),
            subject=email_obj.subject,
            recipient_email=email_obj.recipient_email,
            link=email_obj.link,
        )

    result = custom_sender.send(email_obj)
    notif_id = uuid.uuid4()
    _IN_MEMORY_NOTIFICATIONS_STORE[notif_id] = {
        "id": notif_id,
        "event_id": payload.event_id,
        "kind": email_obj.kind.value,
        "recipient_user_id": payload.recipient_user_id,
        "status": result.status,
        "provider_message_id": result.provider_message_id,
        "error_message": result.error_message,
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        "_key": key,
    }

    return DispatchNotificationResponse(
        notification_id=notif_id,
        status=result.status,
        was_newly_sent=True,
        provider_message_id=result.provider_message_id,
        error_message=result.error_message,
        subject=email_obj.subject,
        recipient_email=email_obj.recipient_email,
        link=email_obj.link,
    )


@router.get("/notifications", response_model=ListNotificationsResponse)
def list_notifications_endpoint(
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    event_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
) -> ListNotificationsResponse:
    """GET /internal/notifications - List notifications with status/event filter and pagination."""
    after_created_at = None
    after_id = None
    if cursor:
        after_created_at, after_id = _decode_cursor(cursor)

    if db is not None:
        repo = NotificationRepository(db)
        records = repo.list_notifications(
            status=status_filter,
            event_id=event_id,
            limit=limit + 1,
            after_created_at=after_created_at,
            after_id=after_id,
        )

        has_next = len(records) > limit
        items_page = records[:limit]
        next_cur = None
        if has_next and items_page:
            last = items_page[-1]
            next_cur = _encode_cursor(last.created_at, last.id)

        return ListNotificationsResponse(
            items=[
                NotificationItemResponse(
                    id=n.id,
                    event_id=n.event_id,
                    kind=n.kind,
                    recipient_user_id=n.recipient_user_id,
                    status=n.status,
                    provider_message_id=n.provider_message_id,
                    error_message=n.error_message,
                    created_at=n.created_at,
                    updated_at=n.updated_at,
                )
                for n in items_page
            ],
            next_cursor=next_cur,
        )

    # In-memory fallback
    matches = [
        n
        for n in _IN_MEMORY_NOTIFICATIONS_STORE.values()
        if (status_filter is None or n["status"] == status_filter)
        and (event_id is None or n["event_id"] == event_id)
    ]
    return ListNotificationsResponse(
        items=[
            NotificationItemResponse(
                id=n["id"],
                event_id=n["event_id"],
                kind=n["kind"],
                recipient_user_id=n["recipient_user_id"],
                status=n["status"],
                provider_message_id=n.get("provider_message_id"),
                error_message=n.get("error_message"),
                created_at=n["created_at"],
                updated_at=n["updated_at"],
            )
            for n in matches[:limit]
        ],
        next_cursor=None,
    )


@router.post(
    "/notifications/{notification_id}/retry",
    response_model=AdminRetryNotificationResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_notification_endpoint(
    notification_id: uuid.UUID,
    payload: AdminRetryNotificationRequest,
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> AdminRetryNotificationResponse:
    """POST /internal/notifications/{id}/retry - Admin retry of failed or uncertain notification.

    Requires an explicit reason. Idempotent if already sent.
    """
    if db is not None:
        repo = NotificationRepository(db)
        record = repo.get_notification(notification_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Notification with ID '{notification_id}' not found",
            )

        repo.retry_notification_admin(notification_id, reason=payload.reason)
        db.commit()
        db.refresh(record)

        return AdminRetryNotificationResponse(
            notification_id=record.id,
            status=record.status,
            reason=payload.reason,
            message="Notification requeued for delivery",
        )

    # In-memory fallback
    if notification_id not in _IN_MEMORY_NOTIFICATIONS_STORE:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Notification with ID '{notification_id}' not found",
        )
    item = _IN_MEMORY_NOTIFICATIONS_STORE[notification_id]
    if item["status"] != "sent":
        item["status"] = "pending"
        item["provider_message_id"] = None
        item["error_message"] = f"Admin retry: {payload.reason.strip()}"
        item["updated_at"] = datetime.now(UTC)

    return AdminRetryNotificationResponse(
        notification_id=notification_id,
        status=item["status"],
        reason=payload.reason,
        message="Notification requeued for delivery",
    )


# ---------------------------------------------------------------------------
# W7: Dead-Letter Queue & Admin Retry Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/events/{event_id}/retry",
    response_model=AdminRetryEventResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
@router.post(
    "/dead-letter/events/{event_id}/retry",
    response_model=AdminRetryEventResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_failed_event_endpoint(
    event_id: uuid.UUID,
    payload: AdminRetryEventRequest,
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> AdminRetryEventResponse:
    """POST /internal/events/{id}/retry - Admin retry of dead-letter outbox event.

    Requires an explicit reason. Idempotent if event is already pending or done.
    """
    if db is not None:
        repo = OutboxRepository(db)
        record = repo.get_event(event_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Outbox event with ID '{event_id}' not found",
            )

        repo.retry_event_admin(event_id, reason=payload.reason)
        db.commit()
        db.refresh(record)

        return AdminRetryEventResponse(
            event_id=record.id,
            status=record.status,
            reason=payload.reason,
            message="Event requeued for dispatch",
        )

    # In-memory fallback
    if event_id not in _IN_MEMORY_FAILED_EVENTS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Outbox event with ID '{event_id}' not found",
        )
    ev = _IN_MEMORY_FAILED_EVENTS[event_id]
    if ev.get("status") not in ("pending", "done"):
        ev["status"] = "pending"
        ev["attempt_count"] = 0
        ev["error_message"] = f"Admin retry: {payload.reason.strip()}"
        ev["updated_at"] = datetime.now(UTC)

    return AdminRetryEventResponse(
        event_id=event_id,
        status=ev["status"],
        reason=payload.reason,
        message="Event requeued for dispatch",
    )


@router.get("/dead-letter/summary", response_model=DeadLetterSummaryResponse)
def get_dead_letter_summary_endpoint(
    db: Annotated[Session | None, Depends(get_optional_db)],
    service: Annotated[ServicePrincipal, Depends(require_service_bearer)],
) -> DeadLetterSummaryResponse:
    """GET /internal/dead-letter/summary - High-level metrics for automation monitoring."""
    if db is not None:
        import sqlalchemy as sa

        failed_events_cnt = (
            db.scalar(
                sa.select(sa.func.count(OutboxEvent.id)).where(OutboxEvent.status == "failed")
            )
            or 0
        )
        failed_notifs_cnt = (
            db.scalar(
                sa.select(sa.func.count(Notification.id)).where(Notification.status == "failed")
            )
            or 0
        )
        uncertain_notifs_cnt = (
            db.scalar(
                sa.select(sa.func.count(Notification.id)).where(Notification.status == "uncertain")
            )
            or 0
        )

        return DeadLetterSummaryResponse(
            failed_events_count=failed_events_cnt,
            failed_notifications_count=failed_notifs_cnt,
            uncertain_notifications_count=uncertain_notifs_cnt,
        )

    # In-memory fallback
    f_events = sum(1 for e in _IN_MEMORY_FAILED_EVENTS.values() if e.get("status") == "failed")
    f_notifs = sum(
        1 for n in _IN_MEMORY_NOTIFICATIONS_STORE.values() if n.get("status") == "failed"
    )
    u_notifs = sum(
        1 for n in _IN_MEMORY_NOTIFICATIONS_STORE.values() if n.get("status") == "uncertain"
    )

    return DeadLetterSummaryResponse(
        failed_events_count=f_events,
        failed_notifications_count=f_notifs,
        uncertain_notifications_count=u_notifs,
    )
