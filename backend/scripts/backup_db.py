#!/usr/bin/env python3
"""PostgreSQL database backup automation script for Campus Incident Management (N1-W11).

Usage:
    python backend/scripts/backup_db.py [--db-url postgresql://...] [--out backup.sql]
"""

import argparse
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def backup_database(db_url: str | None = None, out_path: str | None = None) -> Path:
    url = db_url or os.environ.get("DATABASE_URL") or os.environ.get("TEST_DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL or --db-url is required")

    # Normalize url from sqlalchemy style if necessary
    clean_url = url.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+asyncpg://", "postgresql://"
    )

    if not out_path:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = Path(__file__).parents[2] / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        target_file = backup_dir / f"campus_incident_backup_{timestamp}.sql"
    else:
        target_file = Path(out_path)
        target_file.parent.mkdir(parents=True, exist_ok=True)

    print(f"[*] Starting backup from {clean_url.split('@')[-1]}...")

    try:
        if target_file.suffix == ".gz":
            import gzip

            temp_file = target_file.with_suffix(".tmp")
            cmd = [
                "pg_dump",
                "--clean",
                "--if-exists",
                "--no-owner",
                "--no-privileges",
                "-d",
                clean_url,
                "-f",
                str(temp_file),
            ]
            subprocess.run(cmd, check=True)
            with open(temp_file, "rb") as f_in, gzip.open(target_file, "wb") as f_out:
                f_out.writelines(f_in)
            temp_file.unlink(missing_ok=True)
        else:
            cmd = [
                "pg_dump",
                "--clean",
                "--if-exists",
                "--no-owner",
                "--no-privileges",
                "-d",
                clean_url,
                "-f",
                str(target_file),
            ]
            subprocess.run(cmd, check=True)
        size_kb = target_file.stat().st_size / 1024
        print(f"[✓] Backup completed successfully: {target_file} ({size_kb:.1f} KB)")
        return target_file
    except subprocess.CalledProcessError as exc:
        print(f"[✗] pg_dump failed with exit code {exc.returncode}", file=sys.stderr)
        sys.exit(exc.returncode)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backup PostgreSQL database")
    parser.add_argument("--db-url", help="PostgreSQL connection string")
    parser.add_argument("--out", help="Output file path")
    args = parser.parse_args()

    backup_database(args.db_url, args.out)
