"""Measure N2 create and list latency on a disposable PostgreSQL database."""

import argparse
import json
import platform
import statistics
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import insert, select, text

from app.auth.policy import Principal
from app.auth.security import hash_password
from app.db import SessionLocal, engine
from app.incidents.models import Incident
from app.incidents.schemas import validate_incident_create
from app.incidents.service import create_incident, list_incidents
from app.main import app
from app.models import User


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return round(ordered[int((len(ordered) - 1) * fraction)], 3)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=10000)
    parser.add_argument("--samples", type=int, default=30)
    args = parser.parse_args()
    if engine.url.database != "campus_incident_bench":
        parser.error("DATABASE_URL must point to the disposable campus_incident_bench database")
    if args.rows < 100 or args.samples < 5:
        parser.error("Use at least 100 rows and 5 samples")

    reporter_id, other_id = uuid4(), uuid4()
    password = "Benchmark-Password-123!"
    start = datetime(2026, 10, 1, tzinfo=UTC)
    with SessionLocal.begin() as db:
        db.add_all(
            User(
                id=user_id,
                email=f"bench-{user_id}@example.com",
                display_name="Benchmark user",
                password_hash=hash_password(password),
                role="reporter",
                is_active=True,
            )
            for user_id in (reporter_id, other_id)
        )
        db.flush()
        for offset in range(0, args.rows, 1000):
            batch = []
            for number in range(offset, min(offset + 1000, args.rows)):
                batch.append(
                    {
                        "id": uuid4(),
                        "reporter_id": reporter_id if number % 2 == 0 else other_id,
                        "category": ("water_leak", "electrical_hazard", "phishing")[number % 3],
                        "title": f"Benchmark incident {number}",
                        "description": "Synthetic incident used only for N2 performance testing.",
                        "building": "Benchmark Building",
                        "answers": {},
                        "reported_at": start + timedelta(seconds=number),
                    }
                )
            db.execute(insert(Incident), batch)

    with engine.begin() as connection:
        connection.execute(text("ANALYZE incidents"))

    principal = Principal(str(reporter_id), "reporter", None)
    list_ms: list[float] = []
    filtered_ms: list[float] = []
    for category, samples in ((None, list_ms), ("water_leak", filtered_ms)):
        for _ in range(args.samples):
            with SessionLocal() as db:
                before = time.perf_counter()
                items, _ = list_incidents(
                    db,
                    principal,
                    limit=20,
                    cursor=None,
                    status=None,
                    category=category,
                    priority=None,
                    department_id=None,
                    triage_required=None,
                    overdue=None,
                    now=datetime.now(UTC),
                )
                samples.append((time.perf_counter() - before) * 1000)
                assert items and all(item.reporter_id == reporter_id for item in items)

    payload = validate_incident_create(
        {
            "category": "water_leak",
            "title": "Benchmark water leak",
            "description": "A synthetic report for measuring incident creation.",
            "building": "Benchmark Building",
            "answers": {"leak_amount": "small", "near_electricity": "no"},
        }
    )
    create_ms = []
    for _ in range(args.samples):
        with SessionLocal() as db:
            before = time.perf_counter()
            incident, created = create_incident(db, reporter_id, uuid4(), payload, uuid4())
            create_ms.append((time.perf_counter() - before) * 1000)
            assert created and incident.reporter_id == reporter_id

    api_list_ms = []
    api_create_ms = []
    with SessionLocal() as db:
        own_ids = {
            str(value)
            for value in db.scalars(select(Incident.id).where(Incident.reporter_id == reporter_id))
        }
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"email": f"bench-{reporter_id}@example.com", "password": password},
        )
        assert login.status_code == 200, login.text
        authorization = {"Authorization": f"Bearer {login.json()['access_token']}"}
        for _ in range(args.samples):
            before = time.perf_counter()
            response = client.get("/api/v1/incidents?limit=20", headers=authorization)
            api_list_ms.append((time.perf_counter() - before) * 1000)
            assert response.status_code == 200, response.text
            assert response.json()["items"]
            assert all(item["id"] in own_ids for item in response.json()["items"])
        for _ in range(args.samples):
            before = time.perf_counter()
            response = client.post(
                "/api/v1/incidents",
                json=payload.model_dump(mode="json"),
                headers={**authorization, "Idempotency-Key": str(uuid4())},
            )
            api_create_ms.append((time.perf_counter() - before) * 1000)
            assert response.status_code == 201, response.text

    with engine.connect() as connection:
        plan = (
            connection.execute(
                text(
                    "EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM incidents "
                    "WHERE reporter_id = :reporter ORDER BY reported_at DESC, id DESC LIMIT 20"
                ),
                {"reporter": reporter_id},
            )
            .scalars()
            .all()
        )

    def metrics(values: list[float]) -> dict:
        return {
            "median_ms": round(statistics.median(values), 3),
            "p95_ms": percentile(values, 0.95),
        }

    print(
        json.dumps(
            {
                "database": engine.url.database,
                "python": platform.python_version(),
                "platform": platform.platform(),
                "seed_rows": args.rows,
                "samples": args.samples,
                "list": metrics(list_ms),
                "list_category": metrics(filtered_ms),
                "create": metrics(create_ms),
                "api_list": metrics(api_list_ms),
                "api_create": metrics(api_create_ms),
                "list_query_plan": plan,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
