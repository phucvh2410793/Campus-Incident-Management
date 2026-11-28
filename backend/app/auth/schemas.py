"""Pydantic schemas for authentication and standard error responses."""

from datetime import datetime
from typing import Any

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, Field, field_validator


class ErrorDetail(BaseModel):
    field: str | None = Field(default=None, description="Tên trường bị lỗi nếu có")
    reason: str | None = Field(default=None, description="Lý do hoặc mã lỗi chi tiết")


class ErrorEnvelope(BaseModel):
    code: str = Field(
        ...,
        description="Mã lỗi dạng snake_case",
        examples=[
            "unauthenticated",
            "invalid_credentials",
            "rate_limited",
            "forbidden",
            "not_found",
        ],
    )
    message: str = Field(..., description="Thông điệp thông báo lỗi cho người dùng")
    details: list[dict[str, Any]] = Field(
        default_factory=list, description="Danh sách chi tiết lỗi nếu có"
    )
    request_id: str = Field(..., description="UUID định danh duy nhất của request để đối chiếu log")


class ErrorResponse(BaseModel):
    error: ErrorEnvelope


class LoginRequest(BaseModel):
    email: str = Field(..., description="Địa chỉ email đăng nhập của người dùng")
    password: str = Field(..., min_length=1, max_length=128, description="Mật khẩu của người dùng")

    @field_validator("email")
    @classmethod
    def validate_login_email(cls, value: str) -> str:
        local, separator, domain = value.rpartition("@")
        is_demo_address = bool(separator) and domain.lower() == "demo.invalid"
        # The demo seed uses .invalid, which the email validator normally rejects.
        candidate = f"{local}@demo.example.com" if is_demo_address else value
        try:
            normalized = validate_email(candidate, check_deliverability=False).normalized
        except EmailNotValidError as exc:
            raise ValueError("Invalid email address") from exc
        if is_demo_address:
            return f"{normalized.rpartition('@')[0]}@demo.invalid"
        return normalized


class UserResponse(BaseModel):
    id: str = Field(..., description="UUID của người dùng")
    email: str = Field(..., description="Email của người dùng")
    display_name: str = Field(..., description="Tên hiển thị của người dùng")
    role: str = Field(
        ..., description="Vai trò hệ thống: reporter, handler, department_manager, administrator"
    )
    department_id: str | None = Field(default=None, description="UUID phòng ban trực thuộc nếu có")
    is_active: bool = Field(..., description="Trạng thái kích hoạt của tài khoản")


class LoginResponse(BaseModel):
    access_token: str = Field(..., description="Bearer token dùng cho các request tiếp theo")
    token_type: str = Field(default="bearer", description="Loại token, mặc định là bearer")
    expires_at: datetime = Field(
        ..., description="Thời điểm token hết hạn tính theo UTC (8 giờ sau khi cấp)"
    )
    user: UserResponse = Field(..., description="Thông tin tóm tắt của người dùng đăng nhập")
