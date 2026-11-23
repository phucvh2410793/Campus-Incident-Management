"""Join the N1 admin audit and N2 supplement migration branches."""

revision = "n1_n2_w6_merge"
down_revision = ("n1_w6_admin_audit", "n2w6_supplements")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
