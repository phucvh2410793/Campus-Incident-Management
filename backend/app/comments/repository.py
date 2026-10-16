from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.comments.models import Comment


class CommentRepository:
    """Caller checks incident scope; internal visibility requires staff policy."""

    def __init__(self, session: Session):
        self.session = session

    def add(self, comment: Comment) -> None:
        self.session.add(comment)

    def list_for_incident(
        self,
        incident_id: UUID,
        *,
        include_internal: bool = False,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Comment]:
        if not 1 <= limit <= 100 or offset < 0:
            raise ValueError("Invalid pagination")
        query = select(Comment).where(Comment.incident_id == incident_id)
        if not include_internal:
            query = query.where(Comment.visibility == "public")
        return list(
            self.session.scalars(
                query.order_by(Comment.created_at, Comment.id).limit(limit).offset(offset)
            )
        )
