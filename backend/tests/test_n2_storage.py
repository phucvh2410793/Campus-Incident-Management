from uuid import uuid4

import pytest
from sqlalchemy import desc, func, inspect, select, tuple_

from app.incidents.seed import DEMO_COUNT, seed_incidents
from app.models import Incident


def test_n2_migration_and_seed_support_repeatable_pagination(test_engine, db_session, test_user):
    inspector = inspect(test_engine)
    assert {"incidents", "incident_attachments", "idempotency_records"} <= set(
        inspector.get_table_names()
    )
    indexes = {index["name"] for index in inspector.get_indexes("incidents")}
    assert {
        "ix_incidents_reporter_reported_at_id",
        "ix_incidents_department_reported_at_id",
        "ix_incidents_handler_reported_at_id",
        "ix_incidents_triage_reported_at_id",
    } <= indexes

    assert seed_incidents(db_session, test_user.id) == DEMO_COUNT
    assert seed_incidents(db_session, test_user.id) == 0
    assert (
        db_session.scalar(
            select(func.count()).select_from(Incident).where(Incident.reporter_id == test_user.id)
        )
        == DEMO_COUNT
    )

    ordered = (
        select(Incident)
        .where(Incident.reporter_id == test_user.id)
        .order_by(desc(Incident.reported_at), desc(Incident.id))
    )
    first = list(db_session.scalars(ordered.limit(20)))
    last = first[-1]
    second = list(
        db_session.scalars(
            ordered.where(
                tuple_(Incident.reported_at, Incident.id) < (last.reported_at, last.id)
            ).limit(20)
        )
    )
    assert len(first) == 20
    assert len(second) == DEMO_COUNT - 20
    assert len({incident.id for incident in first + second}) == DEMO_COUNT
    assert {incident.category for incident in first + second} == {
        "water_leak",
        "electrical_hazard",
        "phishing",
    }
    assert all(incident.status == "reported" and incident.priority is None for incident in first)


def test_seed_rejects_missing_reporter_without_writing(db_session):
    with pytest.raises(ValueError, match="existing reporter"):
        seed_incidents(db_session, uuid4())
