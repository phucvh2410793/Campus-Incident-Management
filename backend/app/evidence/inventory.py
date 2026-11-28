"""Inventory private evidence against PostgreSQL metadata for backup checks."""

import argparse
import hashlib
import json
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import SessionLocal
from app.evidence.models import IncidentAttachment
from app.evidence.storage import stored_path
from app.incidents.models import Incident


def build_inventory(db: Session, directory: Path) -> dict:
    records = db.scalars(select(IncidentAttachment).order_by(IncidentAttachment.id)).all()
    attachments = []
    expected_keys = set()
    for record in records:
        path = stored_path(directory, record.storage_key)
        if not path.is_file():
            raise ValueError(f"Missing evidence for attachment {record.id}")
        content = path.read_bytes()
        if len(content) != record.size_bytes:
            raise ValueError(f"Evidence size differs for attachment {record.id}")
        expected_keys.add(record.storage_key)
        attachments.append(
            {
                "id": str(record.id),
                "incident_id": str(record.incident_id),
                "storage_key": record.storage_key,
                "size_bytes": record.size_bytes,
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    actual_keys = (
        {path.name for path in directory.iterdir() if path.is_file()}
        if directory.exists()
        else set()
    )
    if actual_keys != expected_keys:
        raise ValueError("Evidence directory contains files without database metadata")
    return {
        "format_version": 1,
        "incident_count": db.scalar(select(func.count()).select_from(Incident)),
        "attachments": attachments,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", type=Path, help="Write a private inventory JSON file")
    action.add_argument(
        "--verify", type=Path, help="Compare database and files with inventory JSON"
    )
    args = parser.parse_args()
    with SessionLocal() as db:
        current = build_inventory(db, get_settings().evidence_dir)
    if args.write:
        args.write.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote inventory for {len(current['attachments'])} evidence files")
    else:
        expected = json.loads(args.verify.read_text(encoding="utf-8"))
        if current != expected:
            parser.exit(1, "Database/evidence inventory differs from backup\n")
        print(
            f"PASS: {current['incident_count']} incidents and "
            f"{len(current['attachments'])} evidence files match"
        )


if __name__ == "__main__":
    main()
