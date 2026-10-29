"""Automation package for CIM (N5 ownership).

Provides event envelope definitions, HMAC-SHA256 signature verification,
outbox/event publishing port, outbox & notification persistence, worker stub,
service bearer authentication for /internal/* endpoints, and fixtures for n8n orchestration.
"""

from app.automation.models import Notification, OutboxEvent
from app.automation.publisher import (
    EventPublisher,
    IdempotencyConflictError,
    InMemoryEventPublisher,
    OutboxEventPublisher,
    get_event_publisher,
    set_event_publisher,
)
from app.automation.repository import NotificationRepository, OutboxRepository
from app.automation.router import router as internal_router
from app.automation.schemas import EventEnvelope, EventType
from app.automation.security import (
    DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
    DEFAULT_WEBHOOK_SECRET,
    WebhookVerificationResult,
    build_webhook_headers,
    calculate_signature,
    get_configured_webhook_secrets,
    require_valid_webhook_signature,
    verify_webhook_request,
)
from app.automation.service_auth import (
    ServicePrincipal,
    ServiceTokenManager,
    hash_service_token,
    is_user_token,
    require_service_bearer,
    token_manager,
)
from app.automation.worker import OutboxWorkerStub

__all__ = [
    "EventEnvelope",
    "EventType",
    "EventPublisher",
    "InMemoryEventPublisher",
    "OutboxEventPublisher",
    "get_event_publisher",
    "set_event_publisher",
    "IdempotencyConflictError",
    "OutboxEvent",
    "Notification",
    "OutboxRepository",
    "NotificationRepository",
    "OutboxWorkerStub",
    "calculate_signature",
    "build_webhook_headers",
    "verify_webhook_request",
    "require_valid_webhook_signature",
    "WebhookVerificationResult",
    "DEFAULT_TIMESTAMP_TOLERANCE_SECONDS",
    "DEFAULT_WEBHOOK_SECRET",
    "get_configured_webhook_secrets",
    "ServicePrincipal",
    "ServiceTokenManager",
    "hash_service_token",
    "is_user_token",
    "require_service_bearer",
    "token_manager",
    "internal_router",
]
