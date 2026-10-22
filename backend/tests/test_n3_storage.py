"""Checks for the persisted N3 rule baseline and escalation constraints."""

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.incidents.models import Incident
from app.rules.engine import evaluate_incident
from app.rules.models import RuleEvaluation, RuleVersion
from app.sla.models import Escalation


def test_demo_rules_match_the_shared_fixture(db_session):
    versions = db_session.scalars(select(RuleVersion)).all()
    assert len(versions) == 1
    assert versions[0].version == "demo-v1"
    assert [rule["rule_id"] for rule in versions[0].rules] == [
        f"R{number:02}" for number in range(1, 10)
    ]

    rules_by_id = {rule["rule_id"]: rule for rule in versions[0].rules}
    fixture = json.loads(
        (Path(__file__).parents[2] / "docs" / "fixtures" / "n3_cases.json").read_text(
            encoding="utf-8"
        )
    )
    for case in fixture["classification_cases"]:
        result = evaluate_incident(**case["request"])
        if result.rule_id is None:
            continue
        stored = rules_by_id[result.rule_id]
        for field in ("severity", "priority", "department", "reason"):
            assert stored[field] == getattr(result, field), case["test_id"]
        assert stored.get("safety_flags", []) == list(result.safety_flags), case["test_id"]

    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.add(RuleVersion(id=uuid4(), version="demo-v1", rules=[]))
        db_session.flush()


def test_escalation_is_unique_per_incident_and_level(db_session, test_user):
    incident = Incident(
        id=uuid4(),
        reporter_id=test_user.id,
        category="water_leak",
        title="Demo water leak",
        description="A small water leak in the hallway.",
        building="Building A",
        answers={"leak_amount": "small", "near_electricity": "no"},
    )
    db_session.add(incident)
    db_session.flush()

    version_id = db_session.scalar(select(RuleVersion.id).where(RuleVersion.version == "demo-v1"))
    db_session.add(
        RuleEvaluation(
            id=uuid4(),
            incident_id=incident.id,
            rule_version_id=version_id,
            rule_id="R07",
            severity="low",
            priority="p3",
            department="Cơ sở vật chất",
            reason="Chưa có dấu hiệu tăng cấp",
        )
    )
    deadline = datetime(2026, 11, 2, 17, 0, tzinfo=UTC)
    db_session.add(
        Escalation(
            id=uuid4(),
            incident_id=incident.id,
            level=1,
            priority="p3",
            deadline_at=deadline,
            reason="Acknowledgement overdue",
        )
    )
    db_session.flush()

    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.add(
            Escalation(
                id=uuid4(),
                incident_id=incident.id,
                level=1,
                priority="p3",
                deadline_at=deadline,
                reason="Retry",
            )
        )
        db_session.flush()
