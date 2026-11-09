"""Send a signed CIM event to the n8n event processor (N5 W5).

The script mirrors what ``WebhookDispatcher`` sends: the JSON envelope is
serialized compactly, then ``<timestamp>.<raw_body>`` is signed with HMAC-SHA256
using the webhook secret. All arguments are optional; by default the reported
incident fixture in ``workflows/events/incident_reported.json`` is used.

Examples (from the repository root):

    backend/.venv/Scripts/python.exe scripts/send-signed-event.py \
        --url http://localhost:5678/webhook/events \
        --secret $env:CIM_WEBHOOK_HMAC_SECRET

    # Simulate an expired delivery -> workflow returns 401
    ... --timestamp-offset -301

    # Re-deliver the same event after it is done -> workflow returns 200 duplicate
    ... --event-id d69996e8-ae76-44d4-a396-41694498feb3
"""

import argparse
import hashlib
import hmac
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EVENT_FILE = ROOT / "workflows" / "events" / "incident_reported.json"
DEFAULT_SECRET = "replace-in-production-with-random-secret"


def load_envelope(args: argparse.Namespace) -> dict:
    if args.event_file:
        payload = json.loads(Path(args.event_file).read_text(encoding="utf-8"))
    else:
        payload = json.loads(DEFAULT_EVENT_FILE.read_text(encoding="utf-8"))

    if args.event_id:
        payload["event_id"] = args.event_id
    else:
        payload["event_id"] = str(uuid.uuid4())
    if args.event_type:
        payload["event_type"] = args.event_type
    if args.incident_id:
        payload["incident_id"] = args.incident_id
    if args.request_id:
        payload["request_id"] = args.request_id
    return payload


def sign(timestamp: int, raw_body: bytes, secret: str) -> str:
    payload = f"{timestamp}.".encode("ascii") + raw_body
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        # Vietnamese error details are UTF-8; Windows consoles default to cp1252.
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:5678/webhook/events")
    parser.add_argument("--secret", default=DEFAULT_SECRET)
    parser.add_argument("--event-file")
    parser.add_argument("--event-id")
    parser.add_argument("--event-type")
    parser.add_argument("--incident-id")
    parser.add_argument("--request-id")
    parser.add_argument(
        "--timestamp-offset",
        type=int,
        default=0,
        help="Seconds to add to the current time (negative = expired).",
    )
    args = parser.parse_args()

    envelope = load_envelope(args)
    raw_body = json.dumps(envelope, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    timestamp = int(time.time()) + args.timestamp_offset

    headers = {
        "Content-Type": "application/json",
        "X-CIM-Event-ID": envelope["event_id"],
        "X-CIM-Timestamp": str(timestamp),
        "X-CIM-Signature": sign(timestamp, raw_body, args.secret),
    }
    request = urllib.request.Request(args.url, data=raw_body, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            print(response.status, response.read().decode("utf-8", "replace"))
            return 0
    except urllib.error.HTTPError as exc:
        print(exc.code, exc.read().decode("utf-8", "replace"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
