import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Incident(Base):
    __tablename__ = "incidents"
    __table_args__ = (
        sa.CheckConstraint(
            "category IN ('water_leak', 'electrical_hazard', 'phishing')",
            name="ck_incidents_category",
        ),
        sa.CheckConstraint(
            "status IN ('reported', 'assigned', 'in_progress', 'resolved', 'closed')",
            name="ck_incidents_status",
        ),
        sa.CheckConstraint(
            "severity IS NULL OR severity IN ('low', 'medium', 'high', 'critical')",
            name="ck_incidents_severity",
        ),
        sa.CheckConstraint(
            "priority IS NULL OR priority IN ('p1', 'p2', 'p3')",
            name="ck_incidents_priority",
        ),
        sa.CheckConstraint("version >= 1", name="ck_incidents_version_positive"),
        sa.CheckConstraint("length(title) BETWEEN 5 AND 120", name="ck_incidents_title_length"),
        sa.CheckConstraint(
            "length(description) BETWEEN 20 AND 2000", name="ck_incidents_description_length"
        ),
        sa.CheckConstraint(
            "length(building) BETWEEN 1 AND 120", name="ck_incidents_building_length"
        ),
        sa.CheckConstraint("jsonb_typeof(answers) = 'object'", name="ck_incidents_answers_object"),
        sa.Index("ix_incidents_reported_at_id", "reported_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    reporter_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id"), nullable=False)
    category: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    title: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    description: Mapped[str] = mapped_column(sa.String(2000), nullable=False)
    building: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    location_detail: Mapped[str | None] = mapped_column(sa.String(200))
    observed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    answers: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(sa.String(24), nullable=False, server_default="reported")
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="1")
    triage_required: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.false()
    )
    severity: Mapped[str | None] = mapped_column(sa.String(16))
    priority: Mapped[str | None] = mapped_column(sa.String(8))
    department_id: Mapped[uuid.UUID | None] = mapped_column(sa.ForeignKey("departments.id"))
    assigned_handler_id: Mapped[uuid.UUID | None] = mapped_column(sa.ForeignKey("users.id"))
    rule_evaluation: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    reported_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )
    assigned_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    acknowledged_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    acknowledgment_deadline_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    escalation_level: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="0")


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (sa.Index("ix_idempotency_records_expires_at", "expires_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id"), primary_key=True)
    key: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True)
    request_fingerprint: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    incident_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
