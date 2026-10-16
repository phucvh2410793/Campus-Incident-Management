from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["Low", "Medium", "High", "Critical"]
Priority = Literal["P1", "P2", "P3"]


class RuleResult(BaseModel):
    """Deterministic result of evaluating an incident against demo-v1 rules."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    rule_id: str | None
    rule_version: str = "demo-v1"
    severity: Severity | None
    priority: Priority | None
    department: str
    reason: str = Field(min_length=1)
    triage_required: bool = False
    safety_flags: tuple[str, ...] = ()
