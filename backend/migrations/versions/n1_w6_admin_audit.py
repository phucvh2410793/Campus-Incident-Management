"""Store administrative changes to users, departments and rule versions.

Revision ID: n1_w6_admin_audit
Revises: n4_w2_workflow
"""

import sqlalchemy as sa
from alembic import op

revision = "n1_w6_admin_audit"
down_revision = "n4_w2_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_audit_logs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("before", sa.JSON(), nullable=False),
        sa.Column("after", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_admin_audit_actor_created", "admin_audit_logs", ["actor_id", "created_at"])
    op.create_index("ix_admin_audit_target", "admin_audit_logs", ["target_type", "target_id"])


def downgrade() -> None:
    op.drop_index("ix_admin_audit_target", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_actor_created", table_name="admin_audit_logs")
    op.drop_table("admin_audit_logs")
