"""Audit records for administrative changes outside an incident."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"
    __table_args__ = (
        sa.Index("ix_admin_audit_actor_created", "actor_id", "created_at"),
        sa.Index("ix_admin_audit_target", "target_type", "target_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    target_type: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    request_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    before: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    after: Mapped[dict] = mapped_column(sa.JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )
