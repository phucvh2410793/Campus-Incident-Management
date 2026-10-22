import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class OutboxEvent(Base):
    """Outbox pattern storage model for reliable event publishing (N5 ownership).

    Stores transactional events to be claimed by worker and dispatched to n8n.
    Guarantees that database changes and events commit atomically.
    """

    __tablename__ = "outbox_events"
    __table_args__ = (
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'done', 'failed')",
            name="ck_outbox_events_status",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_outbox_events_attempt_count"),
        sa.Index("ix_outbox_events_claim", "status", "next_attempt_at", "lease_expires_at"),
        sa.Index("ix_outbox_events_incident_id", "incident_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    incident_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    request_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    schema_version: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=1, server_default="1"
    )
    status: Mapped[str] = mapped_column(
        sa.String(20), nullable=False, default="pending", server_default="pending"
    )
    payload: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB().with_variant(sa.JSON(), "sqlite"), nullable=True
    )
    attempt_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, server_default="0"
    )
    max_attempts: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=5, server_default="5"
    )
    lease_token: Mapped[str | None] = mapped_column(sa.String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    next_attempt_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )


class Notification(Base):
    """Notification claim and delivery record model (N5 ownership).

    Enforces idempotency key (event_id, kind, recipient_user_id) to prevent duplicate
    notification dispatch under retry or network uncertainty.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'failed', 'uncertain')",
            name="ck_notifications_status",
        ),
        sa.UniqueConstraint(
            "event_id",
            "kind",
            "recipient_user_id",
            name="uq_notifications_event_kind_recipient",
        ),
        sa.Index("ix_notifications_event_id", "event_id"),
        sa.Index("ix_notifications_recipient_user_id", "recipient_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)
    kind: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        sa.String(20), nullable=False, default="pending", server_default="pending"
    )
    provider_message_id: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    error_message: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )
