"""Stored rule versions and evaluation history."""

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RuleVersion(Base):
    __tablename__ = "rule_versions"
    __table_args__ = (sa.UniqueConstraint("version", name="uq_rule_versions_version"),)

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    version: Mapped[str] = mapped_column(sa.String(40), nullable=False)
    rules: Mapped[list[dict[str, Any]]] = mapped_column(sa.JSON, nullable=False)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.true())
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


class RuleEvaluation(Base):
    __tablename__ = "rule_evaluations"
    __table_args__ = (sa.Index("ix_rule_evaluations_incident_id", "incident_id"),)

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("incidents.id"), nullable=False)
    rule_version_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("rule_versions.id", ondelete="RESTRICT"), nullable=False
    )
    rule_id: Mapped[str | None] = mapped_column(sa.String(16))
    severity: Mapped[str | None] = mapped_column(sa.String(16))
    priority: Mapped[str | None] = mapped_column(sa.String(8))
    department: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    reason: Mapped[str] = mapped_column(sa.Text, nullable=False)
    triage_required: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )
    safety_flags: Mapped[list[str]] = mapped_column(
        sa.JSON, nullable=False, server_default=sa.text("'[]'")
    )
    evaluated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
