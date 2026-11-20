"""Notification claim, email formatting and test email dispatch (N5 W6 & W7).

Implements:
- Notification claim idempotency via key (event_id, kind, recipient_user_id).
- Safe test email formatting for reported, assigned, and P1 alerts.
- Strict security guards: NEVER send files, raw secrets, or internal notes.
- Delivery outcome states: sent, failed, and uncertain.
- Invariant: uncertain notifications must NEVER be automatically resent.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from sqlalchemy.orm import Session

from app.automation.models import Notification
from app.automation.repository import NotificationRepository


class NotificationKind(StrEnum):
    """Notification kinds supported by CIM automation (API contract)."""

    INCIDENT_REPORTED = "incident_reported"
    INCIDENT_ASSIGNED = "incident_assigned"
    P1_ALERT = "p1_alert"


class NotificationDeliveryStatus(StrEnum):
    """Delivery statuses for notifications."""

    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    UNCERTAIN = "uncertain"


# Regex patterns for prohibited content in notification emails
PROHIBITED_SECRET_PATTERNS = [
    re.compile(r"password", re.IGNORECASE),
    re.compile(r"password_hash", re.IGNORECASE),
    re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
    re.compile(r"access_token", re.IGNORECASE),
    re.compile(r"refresh_token", re.IGNORECASE),
    re.compile(r"client_secret", re.IGNORECASE),
    re.compile(r"WEBHOOK_HMAC_SECRET", re.IGNORECASE),
    re.compile(r"argon2", re.IGNORECASE),
]

PROHIBITED_FILE_PATTERNS = [
    re.compile(r"data:(?:image|application|text)/[a-zA-Z0-9\.\-]+;base64,", re.IGNORECASE),
    re.compile(r"base64,[A-Za-z0-9+/=]{20,}", re.IGNORECASE),
    re.compile(r"\battachment_id\b", re.IGNORECASE),
    re.compile(r"\battachments/\b", re.IGNORECASE),
    re.compile(r"\bdownload\?[^ \n\r\t]+token=", re.IGNORECASE),
]

PROHIBITED_INTERNAL_PATTERNS = [
    re.compile(r"\[internal\]", re.IGNORECASE),
    re.compile(r"ghi\s+chú\s+nội\s+bộ", re.IGNORECASE),
    re.compile(r"internal_note", re.IGNORECASE),
    re.compile(r"visibility:\s*internal", re.IGNORECASE),
    re.compile(r"is_internal\s*[:=]\s*true", re.IGNORECASE),
]


class NotificationSecurityError(ValueError):
    """Raised when an email payload contains prohibited sensitive content."""


@dataclass(frozen=True)
class NotificationEmail:
    """Safe email envelope ready for dispatch."""

    recipient_user_id: uuid.UUID
    recipient_email: str
    subject: str
    body_text: str
    link: str
    kind: NotificationKind
    incident_id: uuid.UUID
    body_html: str | None = None


def validate_notification_safety(email: NotificationEmail) -> None:
    """Enforce strict security policy on notification email content.

    Rules (docs/business-requirements.md & docs/api-contract.md):
    - NO raw secrets (passwords, session bearer tokens, API credentials, HMAC secrets).
    - NO file attachments, file binary payloads, base64 data, or signed file download URLs.
    - NO internal notes, staff-only comments, or triage internal notes.
    """
    targets = [email.subject, email.body_text, email.link]
    if email.body_html:
        targets.append(email.body_html)

    combined_text = "\n".join(targets)

    # 1. Check for raw secrets
    for pattern in PROHIBITED_SECRET_PATTERNS:
        match = pattern.search(combined_text)
        if match:
            raise NotificationSecurityError(
                f"Prohibited secret pattern detected in notification email: '{match.group(0)}'"
            )

    # 2. Check for file attachments or raw binary data
    for pattern in PROHIBITED_FILE_PATTERNS:
        match = pattern.search(combined_text)
        if match:
            raise NotificationSecurityError(
                f"Prohibited file/binary pattern detected in notification email: '{match.group(0)}'"
            )

    # 3. Check for internal notes
    for pattern in PROHIBITED_INTERNAL_PATTERNS:
        match = pattern.search(combined_text)
        if match:
            raise NotificationSecurityError(
                f"Prohibited internal note detected in notification email: '{match.group(0)}'"
            )


# ---------------------------------------------------------------------------
# Email Builders for the 3 MVP Scenarios (W6)
# ---------------------------------------------------------------------------


def build_reported_notification(
    incident_id: uuid.UUID,
    reporter_user_id: uuid.UUID,
    reporter_email: str,
    *,
    category: str | None = None,
    occurred_at: datetime | None = None,
    frontend_base_url: str = "http://localhost:5173",
) -> NotificationEmail:
    """Build confirmation email to reporter upon incident creation.

    Links to the public reporter view: /incidents/{incident_id}.
    Does NOT contain files, internal notes, or secrets.
    """
    short_id = str(incident_id)[:8]
    cat_label = category or "Sự cố cơ sở vật chất / an toàn"
    timestamp_str = (
        occurred_at.strftime("%Y-%m-%d %H:%M:%S UTC")
        if occurred_at
        else datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    )
    link = f"{frontend_base_url.rstrip('/')}/incidents/{incident_id}"

    subject = f"[CIM] Tiếp nhận báo cáo sự cố #{short_id}"
    body_text = (
        f"Xin chào,\n\n"
        f"Hệ thống Campus Incident Management đã tiếp nhận báo cáo của bạn:\n"
        f"- Mã sự cố: {incident_id}\n"
        f"- Danh mục: {cat_label}\n"
        f"- Thời gian ghi nhận: {timestamp_str}\n"
        f"- Trạng thái: Đang chờ xử lý\n\n"
        f"Bạn có thể theo dõi tiến độ xử lý và cập nhật bổ sung tại liên kết sau:\n"
        f"{link}\n\n"
        f"Trân trọng,\n"
        f"Đội ngũ hỗ trợ khuôn viên CIM"
    )

    email = NotificationEmail(
        recipient_user_id=reporter_user_id,
        recipient_email=reporter_email,
        subject=subject,
        body_text=body_text,
        link=link,
        kind=NotificationKind.INCIDENT_REPORTED,
        incident_id=incident_id,
    )
    validate_notification_safety(email)
    return email


def build_assigned_notification(
    incident_id: uuid.UUID,
    handler_user_id: uuid.UUID,
    handler_email: str,
    *,
    department_name: str | None = None,
    priority: str | None = None,
    frontend_base_url: str = "http://localhost:5173",
) -> NotificationEmail:
    """Build assignment notification to staff technician (handler).

    Links to the staff management portal: /staff/incidents/{incident_id}.
    Does NOT contain files, internal notes, or secrets.
    """
    short_id = str(incident_id)[:8]
    dept_label = department_name or "Bộ phận kỹ thuật"
    priority_label = priority or "P2"
    link = f"{frontend_base_url.rstrip('/')}/staff/incidents/{incident_id}"

    subject = f"[CIM] Phân công xử lý sự cố #{short_id}"
    body_text = (
        f"Kính gửi nhân viên kỹ thuật,\n\n"
        f"Bạn vừa được phân công xử lý sự cố mới:\n"
        f"- Mã sự cố: {incident_id}\n"
        f"- Bộ phận phụ trách: {dept_label}\n"
        f"- Mức ưu tiên: {priority_label}\n\n"
        f"Vui lòng truy cập hệ thống để tiếp nhận (Acknowledge) và thực hiện xử lý:\n"
        f"{link}\n\n"
        f"Hệ thống quản lý sự cố khuôn viên"
    )

    email = NotificationEmail(
        recipient_user_id=handler_user_id,
        recipient_email=handler_email,
        subject=subject,
        body_text=body_text,
        link=link,
        kind=NotificationKind.INCIDENT_ASSIGNED,
        incident_id=incident_id,
    )
    validate_notification_safety(email)
    return email


def build_p1_alert_notification(
    incident_id: uuid.UUID,
    manager_user_id: uuid.UUID,
    manager_email: str,
    *,
    reason: str | None = None,
    deadline: datetime | None = None,
    frontend_base_url: str = "http://localhost:5173",
) -> NotificationEmail:
    """Build urgent emergency alert notification for P1 incidents to department manager.

    Links to the staff triage/escalation view: /staff/incidents/{incident_id}.
    Does NOT contain files, internal notes, or secrets.
    """
    short_id = str(incident_id)[:8]
    reason_label = reason or "Sự cố có mức độ nghiêm trọng cao cần xử lý khẩn cấp"
    deadline_str = (
        deadline.strftime("%Y-%m-%d %H:%M:%S UTC")
        if deadline
        else "Trong vòng 30 phút kể từ khi báo cáo"
    )
    link = f"{frontend_base_url.rstrip('/')}/staff/incidents/{incident_id}"

    subject = f"[CIM KHẨN CẤP] Cảnh báo sự cố mức độ P1 #{short_id}"
    body_text = (
        f"CẢNH BÁO KHẨN CẤP (P1 CRITICAL ALERT)\n\n"
        f"Sự cố sau đây được phân loại mức ưu tiên P1:\n"
        f"- Mã sự cố: {incident_id}\n"
        f"- Lý do đánh giá: {reason_label}\n"
        f"- Hạn tiếp nhận SLA: {deadline_str}\n\n"
        f"Đề nghị ban quản lý và đội trực ca khẩn trương kiểm tra và điều phối nhân sự:\n"
        f"{link}\n\n"
        f"Ban quản lý an toàn & vận hành khuôn viên"
    )

    email = NotificationEmail(
        recipient_user_id=manager_user_id,
        recipient_email=manager_email,
        subject=subject,
        body_text=body_text,
        link=link,
        kind=NotificationKind.P1_ALERT,
        incident_id=incident_id,
    )
    validate_notification_safety(email)
    return email


# ---------------------------------------------------------------------------
# Test Email Sender & Dispatching Engine
# ---------------------------------------------------------------------------


@dataclass
class EmailDispatchResult:
    """Result of an email sending attempt."""

    status: Literal["sent", "failed", "uncertain"]
    provider_message_id: str | None = None
    error_message: str | None = None


class DemoEmailSender:
    """In-memory demo email sender simulating SMTP / mail provider.

    Captures sent emails for verification and supports simulated failure
    and uncertain network states.
    """

    def __init__(self) -> None:
        self.sent_emails: list[NotificationEmail] = []
        self._next_outcome: Literal["sent", "failed", "uncertain"] | None = None
        self._next_error: str | None = None

    def set_next_outcome(
        self,
        outcome: Literal["sent", "failed", "uncertain"],
        error_message: str | None = None,
    ) -> None:
        """Force the outcome of the subsequent send call (used for testing)."""
        self._next_outcome = outcome
        self._next_error = error_message

    def send(self, email: NotificationEmail) -> EmailDispatchResult:
        """Deliver the email to the test mailbox or simulate failure."""
        validate_notification_safety(email)

        outcome = self._next_outcome or "sent"
        error_msg = self._next_error
        self._next_outcome = None
        self._next_error = None

        if outcome == "sent":
            self.sent_emails.append(email)
            msg_id = f"demo-msg-{uuid.uuid4().hex[:12]}"
            return EmailDispatchResult(status="sent", provider_message_id=msg_id)

        if outcome == "failed":
            return EmailDispatchResult(
                status="failed",
                error_message=error_msg or "Mail server rejected recipient: 550 User not found",
            )

        # outcome == "uncertain"
        # Network timeout / dropped connection midway
        return EmailDispatchResult(
            status="uncertain",
            error_message=(
                error_msg
                or "Connection timed out during SMTP DATA stream; delivery state is uncertain"
            ),
        )

    def clear(self) -> None:
        self.sent_emails.clear()
        self._next_outcome = None
        self._next_error = None


# Singleton test sender for automation workflows
demo_email_sender = DemoEmailSender()


def dispatch_notification_task(
    db: Session,
    event_id: uuid.UUID,
    email: NotificationEmail,
    sender: DemoEmailSender | None = None,
) -> tuple[Notification, EmailDispatchResult, bool]:
    """Execute complete notification claim and dispatch workflow atomically.

    Steps:
    1. Claim notification task via (event_id, kind, recipient_user_id).
    2. If already claimed (should_send == False): return immediately without sending.
    3. If should_send == True: deliver email via sender.
    4. Record final outcome (sent, failed, or uncertain) via complete_notification.
    5. Returns (notification, result, was_newly_sent).

    Under NO circumstances will an 'uncertain' or 'sent' notification be automatically resent.
    """
    repo = NotificationRepository(db)
    notification, should_send = repo.claim_notification(
        event_id=event_id,
        kind=email.kind.value if isinstance(email.kind, NotificationKind) else str(email.kind),
        recipient_user_id=email.recipient_user_id,
    )

    if not should_send:
        # Already claimed - return existing record without dispatch
        existing_result = EmailDispatchResult(
            status=notification.status,  # type: ignore[arg-type]
            provider_message_id=notification.provider_message_id,
            error_message=notification.error_message,
        )
        return notification, existing_result, False

    active_sender = sender or demo_email_sender
    try:
        dispatch_result = active_sender.send(email)
    except Exception as exc:  # noqa: BLE001
        dispatch_result = EmailDispatchResult(
            status="uncertain",
            error_message=f"Unexpected exception during dispatch: {exc}",
        )

    completed_record = repo.complete_notification(
        notification_id=notification.id,
        status=dispatch_result.status,
        provider_message_id=dispatch_result.provider_message_id,
        error_message=dispatch_result.error_message,
    )
    assert completed_record is not None
    return completed_record, dispatch_result, True
