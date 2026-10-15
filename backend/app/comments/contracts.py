from typing import Literal

from pydantic import Field

from app.workflow.contracts import Request


class CommentRequest(Request):
    body: str = Field(min_length=1, max_length=2000)
    visibility: Literal["public", "internal"]
