"""N4 persistence models; identity and incident tables belong to N1/N2."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Record:
    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("incidents.id"), index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )


class Assignment(Record, Base):
    __tablename__ = "assignments"
    __table_args__ = (sa.CheckConstraint("length(trim(reason)) > 0", name="ck_assignments_reason"),)
    department_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("departments.id"), index=True)
    handler_id: Mapped[uuid.UUID | None] = mapped_column(sa.ForeignKey("users.id"), index=True)
    reason: Mapped[str] = mapped_column(sa.Text)


class StatusHistory(Record, Base):
    __tablename__ = "status_history"
    __table_args__ = (
        sa.CheckConstraint(
            "from_status IN ('reported','assigned','in_progress','resolved','closed') "
            "AND to_status IN ('reported','assigned','in_progress','resolved','closed')",
            name="ck_status_history_statuses",
        ),
        sa.CheckConstraint("from_status <> to_status", name="ck_status_history_changed"),
        sa.CheckConstraint("incident_version >= 1", name="ck_status_history_version"),
        sa.UniqueConstraint("incident_id", "incident_version", name="uq_history_incident_version"),
        sa.CheckConstraint("visibility IN ('public','internal')", name="ck_history_visibility"),
    )
    from_status: Mapped[str] = mapped_column(sa.String(24))
    to_status: Mapped[str] = mapped_column(sa.String(24))
    incident_version: Mapped[int] = mapped_column(sa.Integer)
    reason: Mapped[str | None] = mapped_column(sa.Text)
    resolution: Mapped[str | None] = mapped_column(sa.Text)
    visibility: Mapped[str] = mapped_column(sa.String(8), server_default="public")


class AuditLog(Record, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (sa.CheckConstraint("length(trim(action)) > 0", name="ck_audit_action"),)
    action: Mapped[str] = mapped_column(sa.String(80))
    request_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, index=True)
    before: Mapped[dict] = mapped_column(sa.JSON)
    after: Mapped[dict] = mapped_column(sa.JSON)
