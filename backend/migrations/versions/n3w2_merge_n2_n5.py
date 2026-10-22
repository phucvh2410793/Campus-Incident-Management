"""Join the N2 incident and N5 outbox migration branches."""

revision = "n3w2_merge_n2_n5"
down_revision = ("n2w2_incident_storage", "n5_w2_outbox_notifications")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
