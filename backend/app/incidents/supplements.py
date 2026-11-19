"""Reporter additions to an incident; they do not change its original answers."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class IncidentSupplement(Base):
    __tablename__ = "incident_supplements"
    __table_args__ = (
        sa.CheckConstraint("length(trim(text)) BETWEEN 1 AND 2000", name="ck_supplements_text"),
        sa.UniqueConstraint("incident_id", "incident_version", name="uq_supplements_version"),
        sa.Index("ix_supplements_incident_created", "incident_id", "created_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("incidents.id"), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id"), nullable=False)
    text: Mapped[str] = mapped_column(sa.String(2000), nullable=False)
    incident_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
