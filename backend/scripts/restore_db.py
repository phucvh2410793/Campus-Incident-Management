#!/usr/bin/env python3
"""PostgreSQL database restore automation script for Campus Incident Management (N1-W11).

Usage:
    python backend/scripts/restore_db.py --input backup.sql [--db-url postgresql://...]
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


def restore_database(backup_file: str, db_url: str | None = None) -> None:
    src_file = Path(backup_file)
    if not src_file.exists():
        print(f"[✗] Backup file not found: {src_file}", file=sys.stderr)
        sys.exit(1)

    url = (
        db_url
        or os.environ.get("DATABASE_URL")
        or os.environ.get("TEST_DATABASE_URL")
        or "postgresql://phileblinh@localhost:5432/campus_incident_test"
    )

    clean_url = url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+asyncpg://", "postgresql://"
    )

    print(f"[*] Restoring database to {clean_url.split('@')[-1]} from {src_file.name}...")

    try:
        if src_file.suffix == ".gz":
            import gzip

            with gzip.open(src_file, "rb") as gz_in:
                subprocess.run(
                    ["psql", "-d", clean_url],
                    input=gz_in.read(),
                    check=True,
                    stdout=subprocess.DEVNULL,
                )
        else:
            cmd = ["psql", "-d", clean_url, "-f", str(src_file)]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
        print(f"[✓] Database restore completed successfully from {src_file.name}!")
    except subprocess.CalledProcessError as exc:
        print(f"[✗] psql restore failed with exit code {exc.returncode}", file=sys.stderr)
        sys.exit(exc.returncode)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Restore PostgreSQL database from backup")
    parser.add_argument("--input", required=True, help="Backup SQL file path")
    parser.add_argument("--db-url", help="Target PostgreSQL connection string")
    args = parser.parse_args()

    restore_database(args.input, args.db_url)
