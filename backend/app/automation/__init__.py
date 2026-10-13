"""Automation package for CIM (N5 ownership).

Provides event envelope definitions, HMAC-SHA256 signature verification,
outbox/event publishing port, and fixtures for n8n orchestration.
"""

from app.automation.publisher import EventPublisher, InMemoryEventPublisher, get_event_publisher
from app.automation.schemas import EventEnvelope, EventType
from app.automation.security import (
    WebhookVerificationResult,
    build_webhook_headers,
    calculate_signature,
    verify_webhook_request,
)

__all__ = [
    "EventEnvelope",
    "EventType",
    "EventPublisher",
    "InMemoryEventPublisher",
    "get_event_publisher",
    "calculate_signature",
    "build_webhook_headers",
    "verify_webhook_request",
    "WebhookVerificationResult",
]
