import hashlib
import hmac
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass

HEADER_EVENT_ID = "X-CIM-Event-ID"
HEADER_TIMESTAMP = "X-CIM-Timestamp"
HEADER_SIGNATURE = "X-CIM-Signature"

SIGNATURE_PREFIX = "sha256="
DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 300  # 5 minutes as specified in API contract


@dataclass(frozen=True)
class WebhookVerificationResult:
    """Outcome of webhook signature and timestamp verification."""

    is_valid: bool
    error_code: str | None = None
    error_message: str | None = None
    event_id: uuid.UUID | None = None
    timestamp: int | None = None


def calculate_signature(timestamp: int, raw_body: bytes | str, secret: str | bytes) -> str:
    """Calculate the HMAC-SHA256 signature for a webhook payload.

    The string to sign is `<timestamp>.<raw_body>`.
    Returns signature formatted as `sha256=<hex_digest>`.
    """
    if isinstance(raw_body, str):
        raw_body_bytes = raw_body.encode("utf-8")
    else:
        raw_body_bytes = raw_body

    if isinstance(secret, str):
        secret_bytes = secret.encode("utf-8")
    else:
        secret_bytes = secret

    payload_to_sign = f"{timestamp}.".encode("ascii") + raw_body_bytes
    computed_digest = hmac.new(secret_bytes, payload_to_sign, hashlib.sha256).hexdigest()
    return f"{SIGNATURE_PREFIX}{computed_digest}"


def build_webhook_headers(
    event_id: uuid.UUID | str,
    raw_body: bytes | str,
    secret: str | bytes,
    timestamp: int | None = None,
) -> dict[str, str]:
    """Generate the standard CIM security headers for outbound n8n webhook delivery."""
    ts = int(time.time()) if timestamp is None else timestamp
    sig = calculate_signature(ts, raw_body, secret)
    return {
        HEADER_EVENT_ID: str(event_id),
        HEADER_TIMESTAMP: str(ts),
        HEADER_SIGNATURE: sig,
        "Content-Type": "application/json",
    }


def verify_webhook_request(
    headers: Mapping[str, str],
    raw_body: bytes | str,
    secret: str | bytes,
    tolerance_seconds: int = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
    current_time: int | None = None,
) -> WebhookVerificationResult:
    """Verify an inbound webhook request signature, timestamp tolerance, and event ID.

    Used by n8n webhook nodes or Python verification services.
    Enforces:
    - Presence of required headers (case-insensitive lookup)
    - Valid UUID format for X-CIM-Event-ID
    - Timestamp within +/- tolerance_seconds
    - Constant-time HMAC-SHA256 signature comparison
    """
    normalized_headers = {k.lower(): v for k, v in headers.items()}

    event_id_str = normalized_headers.get(HEADER_EVENT_ID.lower())
    timestamp_str = normalized_headers.get(HEADER_TIMESTAMP.lower())
    signature_str = normalized_headers.get(HEADER_SIGNATURE.lower())

    if not event_id_str or not timestamp_str or not signature_str:
        return WebhookVerificationResult(
            is_valid=False,
            error_code="missing_headers",
            error_message=(
                "Thiếu một trong các header bắt buộc: "
                "X-CIM-Event-ID, X-CIM-Timestamp, X-CIM-Signature"
            ),
        )

    # Validate UUID
    try:
        parsed_event_id = uuid.UUID(event_id_str)
    except (ValueError, TypeError):  # fmt: skip
        return WebhookVerificationResult(
            is_valid=False,
            error_code="invalid_event_id",
            error_message=f"X-CIM-Event-ID không phải UUID hợp lệ: '{event_id_str}'",
        )

    # Validate Timestamp
    try:
        parsed_timestamp = int(timestamp_str)
    except (ValueError, TypeError):  # fmt: skip
        return WebhookVerificationResult(
            is_valid=False,
            error_code="invalid_timestamp_format",
            error_message=f"X-CIM-Timestamp không phải số nguyên hợp lệ: '{timestamp_str}'",
            event_id=parsed_event_id,
        )

    now = int(time.time()) if current_time is None else current_time
    time_delta = now - parsed_timestamp

    if time_delta > tolerance_seconds:
        return WebhookVerificationResult(
            is_valid=False,
            error_code="expired_timestamp",
            error_message=(
                f"Timestamp đã quá hạn ({time_delta}s > {tolerance_seconds}s). Từ chối sự kiện cũ."
            ),
            event_id=parsed_event_id,
            timestamp=parsed_timestamp,
        )

    if time_delta < -tolerance_seconds:
        return WebhookVerificationResult(
            is_valid=False,
            error_code="future_timestamp",
            error_message=(
                "Timestamp ở tương lai lệch quá mức cho phép "
                f"({-time_delta}s > {tolerance_seconds}s)."
            ),
            event_id=parsed_event_id,
            timestamp=parsed_timestamp,
        )

    # Validate Signature
    expected_sig = calculate_signature(parsed_timestamp, raw_body, secret)
    if not hmac.compare_digest(signature_str, expected_sig):
        return WebhookVerificationResult(
            is_valid=False,
            error_code="invalid_signature",
            error_message="Chữ ký X-CIM-Signature không khớp hoặc secret sai.",
            event_id=parsed_event_id,
            timestamp=parsed_timestamp,
        )

    return WebhookVerificationResult(
        is_valid=True,
        event_id=parsed_event_id,
        timestamp=parsed_timestamp,
    )
