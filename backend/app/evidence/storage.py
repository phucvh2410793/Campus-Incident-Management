"""Private evidence storage and content checks."""

import os
import re
from pathlib import Path

MAX_BYTES = 10 * 1024 * 1024


def detect_content_type(data: bytes) -> str | None:
    if data.startswith(b"%PDF-") and data.rstrip().endswith(b"%%EOF"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n") and b"IEND" in data[-32:]:
        return "image/png"
    if data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"):
        return "image/jpeg"
    return None


def safe_filename(value: str) -> str:
    name = value.replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip(" .")
    return name[:255] or "attachment"


def stored_path(directory: Path, key: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", key):
        raise ValueError("Invalid storage key")
    return directory / key


def write_private_file(directory: Path, key: str, data: bytes) -> Path:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = stored_path(directory, key)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return path
