"""Create incident, attachment metadata and idempotency tables.

Revision ID: n2w2_incident_storage
Revises: 154cfddf3634
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "n2w2_incident_storage"
down_revision = "154cfddf3634"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "incidents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reporter_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.String(2000), nullable=False),
        sa.Column("building", sa.String(120), nullable=False),
        sa.Column("location_detail", sa.String(200), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("answers", JSONB(), nullable=False),
        sa.Column("status", sa.String(24), server_default="reported", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("triage_required", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("severity", sa.String(16), nullable=True),
        sa.Column("priority", sa.String(8), nullable=True),
        sa.Column("department_id", sa.Uuid(), nullable=True),
        sa.Column("assigned_handler_id", sa.Uuid(), nullable=True),
        sa.Column("rule_evaluation", JSONB(), nullable=True),
        sa.Column(
            "reported_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledgment_deadline_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("escalation_level", sa.Integer(), server_default="0", nullable=False),
        sa.CheckConstraint(
            "category IN ('water_leak', 'electrical_hazard', 'phishing')",
            name="ck_incidents_category",
        ),
        sa.CheckConstraint(
            "status IN ('reported', 'assigned', 'in_progress', 'resolved', 'closed')",
            name="ck_incidents_status",
        ),
        sa.CheckConstraint(
            "severity IS NULL OR severity IN ('low', 'medium', 'high', 'critical')",
            name="ck_incidents_severity",
        ),
        sa.CheckConstraint(
            "priority IS NULL OR priority IN ('p1', 'p2', 'p3')", name="ck_incidents_priority"
        ),
        sa.CheckConstraint("version >= 1", name="ck_incidents_version_positive"),
        sa.CheckConstraint("length(title) BETWEEN 5 AND 120", name="ck_incidents_title_length"),
        sa.CheckConstraint(
            "length(description) BETWEEN 20 AND 2000", name="ck_incidents_description_length"
        ),
        sa.CheckConstraint(
            "length(building) BETWEEN 1 AND 120", name="ck_incidents_building_length"
        ),
        sa.CheckConstraint("jsonb_typeof(answers) = 'object'", name="ck_incidents_answers_object"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"]),
        sa.ForeignKeyConstraint(["assigned_handler_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_incidents_reported_at_id", "incidents", ["reported_at", "id"])
    op.create_index(
        "ix_incidents_reporter_reported_at_id",
        "incidents",
        ["reporter_id", "reported_at", "id"],
    )
    op.create_index(
        "ix_incidents_department_reported_at_id",
        "incidents",
        ["department_id", "reported_at", "id"],
    )
    op.create_index(
        "ix_incidents_handler_reported_at_id",
        "incidents",
        ["assigned_handler_id", "reported_at", "id"],
    )
    op.create_index(
        "ix_incidents_triage_reported_at_id",
        "incidents",
        ["reported_at", "id"],
        postgresql_where=sa.text("triage_required = true"),
    )

    op.create_table(
        "incident_attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("incident_id", sa.Uuid(), nullable=False),
        sa.Column("uploaded_by", sa.Uuid(), nullable=False),
        sa.Column("storage_key", sa.String(512), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(127), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("size_bytes BETWEEN 1 AND 10485760", name="ck_attachments_size"),
        sa.CheckConstraint(
            "content_type IN ('application/pdf', 'image/png', 'image/jpeg')",
            name="ck_attachments_content_type",
        ),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_incident_attachments_incident_id", "incident_attachments", ["incident_id"])

    op.create_table(
        "idempotency_records",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("incident_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "key"),
        sa.UniqueConstraint("incident_id"),
    )
    op.create_index("ix_idempotency_records_expires_at", "idempotency_records", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_idempotency_records_expires_at", table_name="idempotency_records")
    op.drop_table("idempotency_records")
    op.drop_index("ix_incident_attachments_incident_id", table_name="incident_attachments")
    op.drop_table("incident_attachments")
    op.drop_index("ix_incidents_triage_reported_at_id", table_name="incidents")
    op.drop_index("ix_incidents_handler_reported_at_id", table_name="incidents")
    op.drop_index("ix_incidents_department_reported_at_id", table_name="incidents")
    op.drop_index("ix_incidents_reporter_reported_at_id", table_name="incidents")
    op.drop_index("ix_incidents_reported_at_id", table_name="incidents")
    op.drop_table("incidents")
