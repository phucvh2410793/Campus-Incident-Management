"""Repeatable synthetic incidents for local development and pagination checks."""

import argparse
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Incident, User

DEMO_COUNT = 30
SAMPLES = (
    (
        "water_leak",
        "Small leak in Building A hallway",
        "Water is dripping onto the hallway floor near a classroom.",
        "Building A",
        {"leak_amount": "small", "near_electricity": "no", "slip_risk": False},
    ),
    (
        "electrical_hazard",
        "Smoke near a hallway electrical panel",
        "Smoke is visible near the electrical panel in the hallway.",
        "Building B",
        {"exposed_wire": "unknown", "smoke_or_sparks": "yes", "equipment": "Panel"},
    ),
    (
        "phishing",
        "Suspicious email information entered",
        "A test account entered information after opening a suspicious link.",
        "Building C",
        {
            "interaction": "entered_information",
            "channel": "email",
            "sender_text": "sender@example.invalid",
        },
    ),
)


def seed_incidents(session: Session, reporter_id: UUID) -> int:
    reporter = session.get(User, reporter_id)
    if reporter is None or reporter.role != "reporter":
        raise ValueError(
            "Seed requires an existing reporter user; create one with N1's seed first."
        )

    start = datetime(2026, 10, 11, 9, 0, tzinfo=UTC)
    rows = []
    for number in range(DEMO_COUNT):
        category, title, description, building, answers = SAMPLES[number % len(SAMPLES)]
        reported_at = start + timedelta(minutes=number)
        rows.append(
            {
                "id": uuid5(NAMESPACE_URL, f"cim:n2:w2:{reporter_id}:{number}"),
                "reporter_id": reporter_id,
                "category": category,
                "title": f"{title} (demo {number + 1})",
                "description": description,
                "building": building,
                "location_detail": None,
                "observed_at": reported_at - timedelta(minutes=10),
                "answers": answers,
                "reported_at": reported_at,
                "updated_at": reported_at,
            }
        )

    result = session.execute(
        insert(Incident.__table__)
        .values(rows)
        .on_conflict_do_nothing(index_elements=[Incident.__table__.c.id])
        .returning(Incident.__table__.c.id)
    )
    return len(result.scalars().all())


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed 30 synthetic, unclassified incidents.")
    parser.add_argument("--reporter-id", type=UUID, required=True, help="Existing N1 reporter UUID")
    args = parser.parse_args()
    with SessionLocal.begin() as session:
        inserted = seed_incidents(session, args.reporter_id)
    print(f"Inserted {inserted} demo incidents; {DEMO_COUNT} are available for this reporter.")


if __name__ == "__main__":
    main()
