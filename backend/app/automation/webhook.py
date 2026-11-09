"""Outbound n8n webhook dispatcher for the N5 outbox (W4).

The dispatcher signs every delivery with the shared HMAC secret
(`<timestamp>.<raw_body>`) and classifies the outcome so the worker can decide
between "mark done", "retry with backoff" and "dead-letter".
"""

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC
from typing import Any, Self
from urllib.parse import urlparse

from app.automation.config import OutboxSettings
from app.automation.models import OutboxEvent
from app.automation.security import build_webhook_headers, get_configured_webhook_secrets

# Status codes worth retrying. Everything else in 4xx is a permanent rejection.
RETRYABLE_STATUS_CODES = frozenset({408, 425, 429})
MAX_PAYLOAD_CHARS = 16_384


@dataclass(frozen=True)
class DispatchResult:
    """Outcome of a single webhook delivery attempt."""

    success: bool
    status_code: int | None = None
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = True
    run_id: str | None = None


def build_event_payload(event: OutboxEvent) -> dict[str, Any]:
    """Return the envelope body for an outbox row.

    The stored ``payload`` is authoritative; the columns are used as a fallback
    so rows created by older code can still be delivered. No description,
    evidence or comment is ever added here.
    """
    if event.payload:
        return dict(event.payload)
    occurred_at = event.occurred_at
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=UTC)
    return {
        "event_id": str(event.id),
        "event_type": event.event_type,
        "incident_id": str(event.incident_id),
        "occurred_at": occurred_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "schema_version": event.schema_version,
        "request_id": str(event.request_id),
    }


def serialize_event_payload(event: OutboxEvent) -> bytes:
    """Serialize the envelope deterministically so the signature matches the bytes sent."""
    payload = build_event_payload(event)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    if len(text) > MAX_PAYLOAD_CHARS:
        raise ValueError("Event payload exceeds the maximum allowed size")
    return text.encode("utf-8")


def sanitize_error_message(
    message: str | None, extra_secrets: list[str | bytes] | None = None
) -> str:
    """Trim and redact configured secrets before an error is persisted or logged."""
    if not message:
        return "Unknown dispatch error"

    cleaned = str(message)

    secrets: list[str] = []
    for secret in get_configured_webhook_secrets():
        secrets.append(secret.decode("utf-8", "ignore") if isinstance(secret, bytes) else secret)
    for secret in extra_secrets or []:
        secrets.append(secret.decode("utf-8", "ignore") if isinstance(secret, bytes) else secret)

    for secret in secrets:
        if secret and len(secret) >= 4:
            cleaned = cleaned.replace(secret, "***")

    # Never persist a full URL with credentials or query tokens.
    if "://" in cleaned:
        for token in cleaned.split():
            if "://" in token:
                parsed = urlparse(token)
                if parsed.username or parsed.password:
                    cleaned = cleaned.replace(token, f"{parsed.scheme}://{parsed.hostname}/***")

    return cleaned[:1000]


class WebhookDispatcher:
    """Deliver a signed outbox event to the n8n webhook.

    The callable interface returns ``bool`` so it can be plugged into the
    existing worker port; ``dispatch()`` exposes the full ``DispatchResult``.
    """

    def __init__(
        self,
        url: str,
        secret: str | bytes | None = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        if not url:
            raise ValueError("Webhook URL is required")
        self.url = url
        self._secret = secret
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_settings(cls, settings: OutboxSettings) -> Self:
        return cls(
            url=settings.webhook_url,
            timeout_seconds=settings.timeout_seconds,
        )

    @property
    def secret(self) -> bytes:
        if self._secret is not None:
            return self._secret.encode("utf-8") if isinstance(self._secret, str) else self._secret
        # Primary secret first; rotation secrets stay valid for inbound checks only.
        return get_configured_webhook_secrets()[0]

    def dispatch(self, event: OutboxEvent) -> DispatchResult:
        """POST the signed envelope and classify the result.

        - 2xx: n8n accepted the event (business completion still happens through
          ``/internal/events/{id}/complete``).
        - 408/425/429/5xx/network/timeout: retryable failure.
        - other 4xx: permanent failure, the event goes straight to dead-letter.
        """
        try:
            body = serialize_event_payload(event)
        except ValueError as exc:
            return DispatchResult(
                success=False,
                error_code="payload_too_large",
                error_message=sanitize_error_message(str(exc)),
                retryable=False,
            )

        headers = build_webhook_headers(event.id, body, self.secret)
        request = urllib.request.Request(  # noqa: S310 - URL comes from operator config
            self.url,
            data=body,
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:  # noqa: S310
                status_code = response.status
                raw_response = response.read(MAX_PAYLOAD_CHARS)
        except urllib.error.HTTPError as exc:
            return self._classify_http_error(exc)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            return DispatchResult(
                success=False,
                error_code="network_error",
                error_message=sanitize_error_message(f"Webhook unreachable: {reason}"),
                retryable=True,
            )
        except Exception as exc:  # noqa: BLE001 - never crash the worker loop
            return DispatchResult(
                success=False,
                error_code="unexpected_error",
                error_message=sanitize_error_message(str(exc)),
                retryable=True,
            )

        if 200 <= status_code < 300:
            return DispatchResult(
                success=True,
                status_code=status_code,
                run_id=self._extract_run_id(raw_response),
            )

        retryable = status_code in RETRYABLE_STATUS_CODES or status_code >= 500
        return DispatchResult(
            success=False,
            status_code=status_code,
            error_code=f"http_{status_code}",
            error_message=sanitize_error_message(
                f"Webhook returned HTTP {status_code}: {raw_response[:500]!r}"
            ),
            retryable=retryable,
        )

    def _classify_http_error(self, exc: urllib.error.HTTPError) -> DispatchResult:
        status_code = exc.code
        try:
            detail = exc.read(500).decode("utf-8", "ignore")
        except Exception:  # noqa: BLE001
            detail = ""

        retryable = status_code in RETRYABLE_STATUS_CODES or status_code >= 500
        return DispatchResult(
            success=False,
            status_code=status_code,
            error_code=f"http_{status_code}",
            error_message=sanitize_error_message(f"Webhook returned HTTP {status_code}: {detail}"),
            retryable=retryable,
        )

    def _extract_run_id(self, raw_response: bytes) -> str | None:
        if not raw_response:
            return None
        try:
            data = json.loads(raw_response.decode("utf-8", "ignore"))
        except ValueError:  # UnicodeDecodeError is a ValueError subclass
            return None
        if isinstance(data, dict):
            run_id = data.get("run_id")
            if isinstance(run_id, str) and run_id:
                return run_id[:255]
        return None

    def __call__(self, event: OutboxEvent) -> bool:
        return self.dispatch(event).success
