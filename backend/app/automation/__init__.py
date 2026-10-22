"""Automation package for CIM (N5 ownership).

Provides event envelope definitions, HMAC-SHA256 signature verification,
outbox/event publishing port, outbox & notification persistence, worker stub,
and fixtures for n8n orchestration.
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
from app.automation.schemas import EventEnvelope, EventType
from app.automation.security import (
    WebhookVerificationResult,
    build_webhook_headers,
    calculate_signature,
    verify_webhook_request,
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
    "WebhookVerificationResult",
]
