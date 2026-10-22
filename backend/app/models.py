import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(sa.String(120), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        sa.CheckConstraint(
            "role IN ('reporter', 'handler', 'department_manager', 'administrator')",
            name="ck_users_role",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(sa.String(254), unique=True)
    display_name: Mapped[str] = mapped_column(sa.String(120))
    password_hash: Mapped[str] = mapped_column(sa.String(255))
    role: Mapped[str] = mapped_column(sa.String(32))
    department_id: Mapped[uuid.UUID | None] = mapped_column(sa.ForeignKey("departments.id"))
    is_active: Mapped[bool] = mapped_column(sa.Boolean, server_default=sa.true())
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )


# Register all persistence models for Alembic autogeneration.
from app.auth.models import Session as Session  # noqa: E402, F401
from app.automation.models import Notification as Notification  # noqa: E402, F401
from app.automation.models import OutboxEvent as OutboxEvent  # noqa: E402, F401
from app.comments.models import Comment as Comment  # noqa: E402, F401
from app.evidence.models import IncidentAttachment as IncidentAttachment  # noqa: E402, F401
from app.incidents.models import IdempotencyRecord as IdempotencyRecord  # noqa: E402, F401
from app.incidents.models import Incident as Incident  # noqa: E402, F401
from app.rules.models import RuleEvaluation as RuleEvaluation  # noqa: E402, F401
from app.rules.models import RuleVersion as RuleVersion  # noqa: E402, F401
from app.sla.models import Escalation as Escalation  # noqa: E402, F401
from app.workflow.models import Assignment as Assignment  # noqa: E402, F401
from app.workflow.models import AuditLog as AuditLog  # noqa: E402, F401
from app.workflow.models import StatusHistory as StatusHistory  # noqa: E402, F401
