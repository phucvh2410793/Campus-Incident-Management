import hashlib
import hmac
import os
import time
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from fastapi import HTTPException, Request, status

HEADER_EVENT_ID = "X-CIM-Event-ID"
HEADER_TIMESTAMP = "X-CIM-Timestamp"
HEADER_SIGNATURE = "X-CIM-Signature"

SIGNATURE_PREFIX = "sha256="
DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 300  # 5 minutes as specified in API contract
DEFAULT_WEBHOOK_SECRET = "replace-in-production-with-random-secret"


@dataclass(frozen=True)
class WebhookVerificationResult:
    """Outcome of webhook signature and timestamp verification."""

    is_valid: bool
    error_code: str | None = None
    error_message: str | None = None
    event_id: uuid.UUID | None = None
    timestamp: int | None = None


def get_configured_webhook_secrets() -> list[bytes]:
    """Retrieve configured webhook HMAC secrets from environment outside Git.

    Supports rotation by returning primary secret plus any secondary rotation secrets.
    """
    secrets_list: list[bytes] = []

    primary = os.environ.get("CIM_WEBHOOK_HMAC_SECRET") or os.environ.get("WEBHOOK_HMAC_SECRET")
    if primary:
        secrets_list.append(primary.strip().encode("utf-8"))

    rotation = os.environ.get("CIM_WEBHOOK_HMAC_SECRETS_ROTATION")
    if rotation:
        for s in rotation.split(","):
            cleaned = s.strip()
            if cleaned:
                secrets_list.append(cleaned.encode("utf-8"))

    if not secrets_list:
        secrets_list.append(DEFAULT_WEBHOOK_SECRET.encode("utf-8"))

    return secrets_list


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
    secret: str | bytes | Sequence[str | bytes] | None = None,
    tolerance_seconds: int = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
    current_time: int | None = None,
) -> WebhookVerificationResult:
    """Verify an inbound webhook request signature, timestamp tolerance, and event ID.

    Used by n8n webhook nodes or Python verification services.
    Enforces:
    - Presence of required headers (case-insensitive lookup)
    - Valid UUID format for X-CIM-Event-ID
    - Timestamp within +/- tolerance_seconds (rejects expired or future-skewed events)
    - Constant-time HMAC-SHA256 signature comparison against active secret(s)
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

    # Normalize secrets list for comparison
    if secret is None:
        valid_secrets = get_configured_webhook_secrets()
    elif isinstance(secret, (str, bytes)):
        valid_secrets = [secret.encode("utf-8") if isinstance(secret, str) else secret]
    else:
        valid_secrets = [s.encode("utf-8") if isinstance(s, str) else s for s in secret]

    # Validate Signature with constant-time comparison against each active secret
    signature_matches = False
    for sec in valid_secrets:
        expected_sig = calculate_signature(parsed_timestamp, raw_body, sec)
        if hmac.compare_digest(signature_str, expected_sig):
            signature_matches = True
            break

    if not signature_matches:
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


async def require_valid_webhook_signature(
    request: Request,
) -> WebhookVerificationResult:
    """FastAPI dependency verifying incoming webhook request HMAC signature and timestamp."""
    raw_body = await request.body()
    result = verify_webhook_request(
        headers=request.headers,
        raw_body=raw_body,
        secret=None,
        tolerance_seconds=DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
    )
    if not result.is_valid:
        if result.error_code == "missing_headers":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=result.error_message,
            )
        if result.error_code in ("invalid_event_id", "invalid_timestamp_format"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=result.error_message,
            )
        # expired_timestamp, future_timestamp, invalid_signature
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=result.error_message,
        )
    return result
