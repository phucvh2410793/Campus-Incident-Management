"""Security utilities for redaction, secret protection, and audit safety (N1-W10).

Ensures:
- Sensitive headers (Authorization, Cookie, etc.) are never logged in plaintext.
- Passwords and tokens are never written to audit logs, application logs, or exports.
- Only hashes (Argon2 for passwords, SHA-256 for tokens) reside in the database.
"""

from typing import Any

SENSITIVE_FIELD_NAMES = {
    "password",
    "password_hash",
    "token",
    "token_hash",
    "access_token",
    "secret",
    "api_key",
}

SENSITIVE_HEADERS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
}

REDACTED_PLACEHOLDER = "[REDACTED]"


def redact_sensitive_headers(headers: dict[str, str] | list[tuple[str, str]]) -> dict[str, str]:
    """Return a copy of headers with sensitive values masked."""
    if isinstance(headers, list):
        header_dict = dict(headers)
    else:
        header_dict = dict(headers)

    redacted = {}
    for key, value in header_dict.items():
        if key.lower() in SENSITIVE_HEADERS:
            redacted[key] = REDACTED_PLACEHOLDER
        else:
            redacted[key] = value
    return redacted


def redact_sensitive_data(data: Any) -> Any:
    """Recursively mask sensitive keys in nested dictionaries and lists."""
    if isinstance(data, dict):
        result = {}
        for key, value in data.items():
            if str(key).lower() in SENSITIVE_FIELD_NAMES:
                result[key] = REDACTED_PLACEHOLDER
            elif isinstance(value, (dict, list)):
                result[key] = redact_sensitive_data(value)
            else:
                result[key] = value
        return result
    if isinstance(data, list):
        return [redact_sensitive_data(item) for item in data]
    return data


def contains_plaintext_token_or_secret(data: Any, known_secrets: set[str]) -> bool:
    """Check if any known secret or plaintext token appears anywhere in serialized data."""
    serialized = str(data)
    for secret in known_secrets:
        if secret and secret in serialized:
            return True
    return False
