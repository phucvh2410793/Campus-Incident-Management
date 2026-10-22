import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.workflow.models import Record


class Comment(Record, Base):
    __tablename__ = "comments"
    __table_args__ = (
        sa.CheckConstraint("length(trim(body)) BETWEEN 1 AND 2000", name="ck_comments_body"),
        sa.CheckConstraint("visibility IN ('public','internal')", name="ck_comments_visibility"),
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(sa.String(2000))
    visibility: Mapped[str] = mapped_column(sa.String(8))
