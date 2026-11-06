"""Runtime configuration for the N5 outbox dispatcher (W4).

Secrets and deployment-specific URLs are read from the environment, never from
Git. Defaults are safe for local development only.
"""

import os
from dataclasses import dataclass
from typing import Self

DEFAULT_WEBHOOK_URL = "http://localhost:5678/webhook/events"


def _env_str(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None:
        return default
    cleaned = value.strip()
    return cleaned or default


def _env_int(name: str, default: int) -> int:
    raw = _env_str(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = _env_str(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env_str(name)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class OutboxSettings:
    """Settings for dispatching outbox events to the n8n webhook."""

    webhook_url: str = DEFAULT_WEBHOOK_URL
    timeout_seconds: float = 10.0
    batch_size: int = 10
    lease_duration_seconds: int = 60
    backoff_base_seconds: int = 5
    max_backoff_seconds: int = 300
    poll_interval_seconds: float = 5.0
    worker_id: str | None = None
    enabled: bool = True

    @classmethod
    def from_env(cls) -> Self:
        """Build settings from ``CIM_OUTBOX_*`` variables.

        Also accepts ``N8N_WEBHOOK_URL`` as a fallback so an existing n8n
        deployment only needs one variable.
        """
        webhook_url = (
            _env_str("CIM_OUTBOX_WEBHOOK_URL") or _env_str("N8N_WEBHOOK_URL") or DEFAULT_WEBHOOK_URL
        )
        return cls(
            webhook_url=webhook_url,
            timeout_seconds=_env_float("CIM_OUTBOX_WEBHOOK_TIMEOUT_SECONDS", 10.0),
            batch_size=_env_int("CIM_OUTBOX_BATCH_SIZE", 10),
            lease_duration_seconds=_env_int("CIM_OUTBOX_LEASE_SECONDS", 60),
            backoff_base_seconds=_env_int("CIM_OUTBOX_BACKOFF_BASE_SECONDS", 5),
            max_backoff_seconds=_env_int("CIM_OUTBOX_BACKOFF_MAX_SECONDS", 300),
            poll_interval_seconds=_env_float("CIM_OUTBOX_POLL_INTERVAL_SECONDS", 5.0),
            worker_id=_env_str("CIM_OUTBOX_WORKER_ID"),
            enabled=_env_bool("CIM_OUTBOX_DISPATCH_ENABLED", True),
        )
