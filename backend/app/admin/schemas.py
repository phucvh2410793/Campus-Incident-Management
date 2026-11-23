"""Contracts for the small W6 administrator API."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.auth.router import LoginRequest

Role = Literal["reporter", "handler", "department_manager", "administrator"]
Category = Literal["water_leak", "electrical_hazard", "phishing"]


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    email: str
    display_name: str = Field(min_length=1, max_length=120)
    role: Role
    department_id: UUID | None = None
    password: str = Field(min_length=12, max_length=128, repr=False)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        return LoginRequest.validate_login_email(value).lower()


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_active: bool | None = None
    role: Role | None = None
    department_id: UUID | None = None

    @model_validator(mode="after")
    def must_change_something(self):
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        if ("is_active" in self.model_fields_set and self.is_active is None) or (
            "role" in self.model_fields_set and self.role is None
        ):
            raise ValueError("is_active and role cannot be null")
        return self


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    role: Role
    department_id: UUID | None
    is_active: bool


class UserPage(BaseModel):
    items: list[UserSummary]
    next_cursor: UUID | None


class DepartmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)


class DepartmentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class RuleDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    rule_id: str = Field(min_length=1, max_length=16)
    category: Category
    condition: dict[str, str] = Field(min_length=1)
    severity: Literal["low", "medium", "high", "critical"]
    priority: Literal["p1", "p2", "p3"]
    department: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=500)
    safety_flags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_condition(self):
        fields = {
            "water_leak": {
                "leak_amount": {"small", "large", "unknown"},
                "near_electricity": {"yes", "no", "unknown"},
            },
            "electrical_hazard": {
                "exposed_wire": {"yes", "no", "unknown"},
                "smoke_or_sparks": {"yes", "no", "unknown"},
            },
            "phishing": {
                "interaction": {"none", "clicked_link", "entered_information", "unknown"},
            },
        }
        allowed = fields[self.category]
        if any(
            key not in allowed or value not in allowed[key] for key, value in self.condition.items()
        ):
            raise ValueError("Condition does not match the category answers")
        return self


class RuleVersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    version: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    rules: list[RuleDefinition] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_rule_ids(self):
        ids = [rule.rule_id for rule in self.rules]
        if len(ids) != len(set(ids)):
            raise ValueError("rule_id values must be unique within a version")
        return self


class RuleVersionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    version: str
    rules: list[dict]
    is_active: bool
    created_at: datetime
