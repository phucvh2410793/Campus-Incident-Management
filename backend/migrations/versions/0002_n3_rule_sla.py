
"""Add N3 rule versions, evaluations, and escalations."""

import json
import uuid

import sqlalchemy as sa
from alembic import op

revision = "0002_n3_rule_sla"
down_revision = "0001_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rule_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("version", sa.String(40), nullable=False),
        sa.Column("rules", sa.JSON(), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("version", name="uq_rule_versions_version"),
    )

    op.create_table(
        "rule_evaluations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("incident_id", sa.Uuid(), nullable=False),
        sa.Column(
            "rule_version_id",
            sa.Uuid(),
            sa.ForeignKey("rule_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("rule_id", sa.String(16), nullable=True),
        sa.Column("severity", sa.String(16), nullable=True),
        sa.Column("priority", sa.String(8), nullable=True),
        sa.Column("department", sa.String(120), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "triage_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "safety_flags",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        sa.Column(
            "evaluated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index(
        "ix_rule_evaluations_incident_id",
        "rule_evaluations",
        ["incident_id"],
    )

    op.create_table(
        "escalations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("incident_id", sa.Uuid(), nullable=False),
        sa.Column("level", sa.String(32), nullable=False),
        sa.Column("priority", sa.String(8), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "escalated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.UniqueConstraint(
            "incident_id",
            "level",
            name="uq_escalations_incident_level",
        ),
    )

    op.create_index(
        "ix_escalations_incident_id",
        "escalations",
        ["incident_id"],
    )

    # Seed the demo-v1 rule definition (R01-R09).
    rules = [
        {
            "rule_id": "R01",
            "category": "electrical_hazard",
            "condition": {"smoke_or_sparks": "yes"},
            "severity": "critical",
            "priority": "p1",
            "department": "Điện và an toàn",
            "reason": "Dấu hiệu nguy hiểm tức thời",
        },
        {
            "rule_id": "R02",
            "category": "phishing",
            "condition": {"interaction": "entered_information"},
            "severity": "high",
            "priority": "p1",
            "department": "IT/Security",
            "reason": "Nguy cơ lộ thông tin",
        },
        {
            "rule_id": "R03",
            "category": "water_leak",
            "condition": {"near_electricity": "yes"},
            "severity": "high",
            "priority": "p1",
            "department": "Cơ sở vật chất",
            "reason": (
                "Nước gần điện cần ưu tiên cao; gắn cờ an toàn"
            ),
        },
        {
            "rule_id": "R04",
            "category": "electrical_hazard",
            "condition": {"exposed_wire": "yes"},
            "severity": "high",
            "priority": "p1",
            "department": "Điện và an toàn",
            "reason": "Nguy cơ chạm điện",
        },
        {
            "rule_id": "R05",
            "category": "phishing",
            "condition": {"interaction": "clicked_link"},
            "severity": "medium",
            "priority": "p2",
            "department": "IT/Security",
            "reason": "Cần kiểm tra thiết bị/tài khoản",
        },
        {
            "rule_id": "R06",
            "category": "water_leak",
            "condition": {
                "leak_amount": "large",
                "near_electricity": "no",
            },
            "severity": "medium",
            "priority": "p2",
            "department": "Cơ sở vật chất",
            "reason": "Có nguy cơ lan rộng/trơn trượt",
        },
        {
            "rule_id": "R07",
            "category": "water_leak",
            "condition": {
                "leak_amount": "small",
                "near_electricity": "no",
            },
            "severity": "low",
            "priority": "p3",
            "department": "Cơ sở vật chất",
            "reason": "Chưa có dấu hiệu tăng cấp",
        },
        {
            "rule_id": "R08",
            "category": "phishing",
            "condition": {"interaction": "none"},
            "severity": "low",
            "priority": "p3",
            "department": "IT/Security",
            "reason": "Chưa ghi nhận tương tác",
        },
        {
            "rule_id": "R09",
            "category": "electrical_hazard",
            "condition": {
                "exposed_wire": "no",
                "smoke_or_sparks": "no",
            },
            "severity": "medium",
            "priority": "p2",
            "department": "Điện và an toàn",
            "reason": "Cần kiểm tra tại chỗ",
        },
    ]

    # Use literal SQL so Alembic offline mode (--sql) can render JSON.
    rules_json = json.dumps(rules, ensure_ascii=True)
    rules_sql = rules_json.replace("'", "''")
    version_id = str(uuid.uuid4())

    op.execute(
        "INSERT INTO rule_versions (id, version, rules, is_active) "
        f"VALUES ('{version_id}', 'demo-v1', '{rules_sql}'::json, TRUE)"
    )


def downgrade() -> None:
    op.drop_index(
        "ix_escalations_incident_id",
        table_name="escalations",
    )
    op.drop_table("escalations")

    op.drop_index(
        "ix_rule_evaluations_incident_id",
        table_name="rule_evaluations",
    )
    op.drop_table("rule_evaluations")
    op.drop_table("rule_versions")
