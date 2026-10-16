"""Pending N4 revision: activate only after N2 incident migration is merged.

Move into versions and set down_revision to the actual N2 revision at integration.
It is deliberately outside versions so current main still migrates successfully.
"""

import sqlalchemy as sa
from alembic import op

revision = "n4_w2_workflow"
down_revision = None  # Set to N2's real revision before activation; not a new root.
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Frozen DDL, independent of future ORM edits.
    for table in ("assignments", "comments", "status_history", "audit_logs"):
        columns = [
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("incident_id", sa.Uuid(), sa.ForeignKey("incidents.id"), nullable=False),
            sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        ]
        if table == "assignments":
            columns += [
                sa.Column(
                    "department_id", sa.Uuid(), sa.ForeignKey("departments.id"), nullable=False
                ),
                sa.Column("handler_id", sa.Uuid(), sa.ForeignKey("users.id")),
                sa.Column("reason", sa.Text(), nullable=False),
                sa.CheckConstraint("length(trim(reason)) > 0", name="ck_assignments_reason"),
            ]
        elif table == "comments":
            columns += [
                sa.Column("body", sa.String(2000), nullable=False),
                sa.Column("visibility", sa.String(8), nullable=False),
                sa.CheckConstraint(
                    "length(trim(body)) BETWEEN 1 AND 2000", name="ck_comments_body"
                ),
                sa.CheckConstraint(
                    "visibility IN ('public','internal')", name="ck_comments_visibility"
                ),
            ]
        elif table == "status_history":
            columns += [
                sa.Column("from_status", sa.String(24), nullable=False),
                sa.Column("to_status", sa.String(24), nullable=False),
                sa.Column("incident_version", sa.Integer(), nullable=False),
                sa.Column("reason", sa.Text()),
                sa.Column("resolution", sa.Text()),
                sa.Column("visibility", sa.String(8), server_default="public", nullable=False),
                sa.CheckConstraint(
                    "from_status IN ('reported','assigned','in_progress','resolved','closed') "
                    "AND to_status IN ('reported','assigned','in_progress','resolved','closed')",
                    name="ck_status_history_statuses",
                ),
                sa.CheckConstraint("from_status <> to_status", name="ck_status_history_changed"),
                sa.CheckConstraint("incident_version >= 1", name="ck_status_history_version"),
                sa.UniqueConstraint(
                    "incident_id", "incident_version", name="uq_history_incident_version"
                ),
                sa.CheckConstraint(
                    "visibility IN ('public','internal')", name="ck_history_visibility"
                ),
            ]
        else:
            columns += [
                sa.Column("action", sa.String(80), nullable=False),
                sa.Column("request_id", sa.Uuid(), nullable=False),
                sa.Column("before", sa.JSON(), nullable=False),
                sa.Column("after", sa.JSON(), nullable=False),
                sa.CheckConstraint("length(trim(action)) > 0", name="ck_audit_action"),
            ]
        op.create_table(table, *columns)
        for field in ("incident_id", "actor_id"):
            op.create_index(f"ix_{table}_{field}", table, [field])
        if table == "assignments":
            for field in ("department_id", "handler_id"):
                op.create_index(f"ix_{table}_{field}", table, [field])
        if table == "audit_logs":
            op.create_index("ix_audit_logs_request_id", table, ["request_id"])


def downgrade() -> None:
    for table in ("audit_logs", "status_history", "comments", "assignments"):
        op.drop_table(table)
