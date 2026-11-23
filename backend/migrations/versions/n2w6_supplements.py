"""Store incident supplements without changing the original report."""

import sqlalchemy as sa
from alembic import op

revision = "n2w6_supplements"
down_revision = "n4_w2_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "incident_supplements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("incident_id", sa.Uuid(), sa.ForeignKey("incidents.id"), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("text", sa.String(2000), nullable=False),
        sa.Column("incident_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length(trim(text)) BETWEEN 1 AND 2000", name="ck_supplements_text"),
        sa.UniqueConstraint("incident_id", "incident_version", name="uq_supplements_version"),
    )
    op.create_index(
        "ix_supplements_incident_created",
        "incident_supplements",
        ["incident_id", "created_at", "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_supplements_incident_created", table_name="incident_supplements")
    op.drop_table("incident_supplements")
