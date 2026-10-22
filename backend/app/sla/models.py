"""Stored SLA escalation history."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Escalation(Base):
    __tablename__ = "escalations"
    __table_args__ = (
        sa.CheckConstraint("level >= 1", name="ck_escalations_level_positive"),
        sa.UniqueConstraint("incident_id", "level", name="uq_escalations_incident_level"),
        sa.Index("ix_escalations_incident_id", "incident_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("incidents.id"), nullable=False)
    level: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    priority: Mapped[str] = mapped_column(sa.String(8), nullable=False)
    deadline_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    escalated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    reason: Mapped[str] = mapped_column(sa.Text, nullable=False)
