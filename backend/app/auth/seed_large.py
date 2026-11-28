"""Large-scale synthetic dataset generator for multi-role, multi-department auth & policy tests.

Provides:
- 8 distinct departments.
- 25+ accounts covering reporter, handler, department_manager,
  administrator, and locked/inactive accounts.
- Realistic active, expired, and revoked sessions.
- Multi-department incidents and comments for negative matrix verification.
All credentials use repeatable test hashes; no sensitive passwords are hardcoded in git.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.auth.models import Session as UserSession
from app.auth.security import create_session_token, hash_password, hash_session_token
from app.comments.models import Comment
from app.incidents.models import Incident
from app.models import Department, User

DEFAULT_LARGE_PASSWORD = "Demo-Large-Seed-2026!"

LARGE_DEPARTMENTS: tuple[tuple[UUID, str], ...] = (
    (UUID("20000000-0000-4000-8000-000000000001"), "Cơ sở vật chất"),
    (UUID("20000000-0000-4000-8000-000000000002"), "Điện và an toàn"),
    (UUID("20000000-0000-4000-8000-000000000003"), "IT/Security"),
    (UUID("20000000-0000-4000-8000-000000000004"), "Hàng đợi phân loại thủ công"),
    (UUID("20000000-0000-4000-8000-000000000005"), "Ban Bảo vệ & Trật tự khuôn viên"),
    (UUID("20000000-0000-4000-8000-000000000006"), "Phòng Quản lý Ký túc xá"),
    (UUID("20000000-0000-4000-8000-000000000007"), "Ban An toàn Phòng thí nghiệm"),
    (UUID("20000000-0000-4000-8000-000000000008"), "Phòng Công tác Sinh viên & Y tế"),
)


@dataclass(frozen=True)
class LargeAccountDef:
    id: UUID
    email: str
    display_name: str
    role: str
    department_id: UUID | None
    is_active: bool = True


LARGE_ACCOUNTS: tuple[LargeAccountDef, ...] = (
    # Standard 5 demo accounts
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000001"),
        "reporter@demo.invalid",
        "Demo Reporter",
        "reporter",
        None,
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000002"),
        "handler@demo.invalid",
        "Demo Handler",
        "handler",
        LARGE_DEPARTMENTS[0][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000003"),
        "manager@demo.invalid",
        "Demo Department Manager",
        "department_manager",
        LARGE_DEPARTMENTS[1][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000004"),
        "admin@demo.invalid",
        "Demo Administrator",
        "administrator",
        None,
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000005"),
        "triage.manager@demo.invalid",
        "Demo Triage Manager",
        "department_manager",
        LARGE_DEPARTMENTS[3][0],
    ),
    # Additional Reporters (Active & Inactive)
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000011"),
        "student.a@demo.invalid",
        "Sinh viên Nguyễn Văn A",
        "reporter",
        None,
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000012"),
        "student.b@demo.invalid",
        "Sinh viên Trần Thị B",
        "reporter",
        None,
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000013"),
        "lecturer.c@demo.invalid",
        "Giảng viên Lê Văn C",
        "reporter",
        None,
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000014"),
        "dorm.resident@demo.invalid",
        "Cư dân KTX Phạm Văn D",
        "reporter",
        None,
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000015"),
        "locked.reporter@demo.invalid",
        "Người báo bị khóa",
        "reporter",
        None,
        is_active=False,
    ),
    # Handlers per Department
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000021"),
        "facility.handler1@demo.invalid",
        "Nhân viên CSVC 1",
        "handler",
        LARGE_DEPARTMENTS[0][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000022"),
        "facility.handler2@demo.invalid",
        "Nhân viên CSVC 2",
        "handler",
        LARGE_DEPARTMENTS[0][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000023"),
        "electrical.handler1@demo.invalid",
        "Nhân viên Điện 1",
        "handler",
        LARGE_DEPARTMENTS[1][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000024"),
        "electrical.handler2@demo.invalid",
        "Nhân viên Điện 2",
        "handler",
        LARGE_DEPARTMENTS[1][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000025"),
        "security.handler@demo.invalid",
        "Nhân viên IT Security",
        "handler",
        LARGE_DEPARTMENTS[2][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000026"),
        "campus.guard@demo.invalid",
        "Nhân viên Bảo vệ",
        "handler",
        LARGE_DEPARTMENTS[4][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000027"),
        "lab.technician@demo.invalid",
        "Kỹ thuật viên Lab",
        "handler",
        LARGE_DEPARTMENTS[6][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000028"),
        "locked.handler@demo.invalid",
        "Nhân viên bị khóa",
        "handler",
        LARGE_DEPARTMENTS[0][0],
        is_active=False,
    ),
    # Department Managers
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000031"),
        "facility.manager@demo.invalid",
        "Trưởng ban CSVC",
        "department_manager",
        LARGE_DEPARTMENTS[0][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000032"),
        "electrical.manager@demo.invalid",
        "Trưởng ban Điện",
        "department_manager",
        LARGE_DEPARTMENTS[1][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000033"),
        "it.manager@demo.invalid",
        "Trưởng ban IT Security",
        "department_manager",
        LARGE_DEPARTMENTS[2][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000034"),
        "guard.captain@demo.invalid",
        "Đội trưởng Bảo vệ",
        "department_manager",
        LARGE_DEPARTMENTS[4][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000035"),
        "dorm.manager@demo.invalid",
        "Quản lý KTX",
        "department_manager",
        LARGE_DEPARTMENTS[5][0],
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000036"),
        "locked.manager@demo.invalid",
        "Quản lý bị khóa",
        "department_manager",
        LARGE_DEPARTMENTS[1][0],
        is_active=False,
    ),
    # Administrators
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000041"),
        "sec.admin@demo.invalid",
        "Security Administrator",
        "administrator",
        None,
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000042"),
        "ops.admin@demo.invalid",
        "Operations Administrator",
        "administrator",
        None,
    ),
    LargeAccountDef(
        UUID("10000000-0000-4000-8000-000000000043"),
        "locked.admin@demo.invalid",
        "Admin bị khóa",
        "administrator",
        None,
        is_active=False,
    ),
    # USTH Demo Accounts (matching frontend MOCK_USERS directly for seamless real API login)
    LargeAccountDef(
        UUID("22e09230-76fd-4638-a97f-96919031e40b"),
        "reporter@usth.edu.vn",
        "Lê Minh Tuấn (Sinh viên)",
        "reporter",
        None,
    ),
    LargeAccountDef(
        UUID("33a01234-76fd-4638-a97f-96919031e001"),
        "handler.csvc@usth.edu.vn",
        "Phạm Văn Nam (KTV Cơ sở vật chất)",
        "handler",
        LARGE_DEPARTMENTS[0][0],
    ),
    LargeAccountDef(
        UUID("33a01234-76fd-4638-a97f-96919031e002"),
        "handler.dien@usth.edu.vn",
        "Trần Quốc Tuấn (KTV Điện & An toàn)",
        "handler",
        LARGE_DEPARTMENTS[1][0],
    ),
    LargeAccountDef(
        UUID("44b01234-76fd-4638-a97f-96919031e003"),
        "manager.csvc@usth.edu.vn",
        "Hoàng Đức (Trưởng ban Cơ sở vật chất)",
        "department_manager",
        LARGE_DEPARTMENTS[0][0],
    ),
    LargeAccountDef(
        UUID("44b01234-76fd-4638-a97f-96919031e004"),
        "manager.dien@usth.edu.vn",
        "Đỗ Thị Hà (Trưởng ban Điện & An toàn)",
        "department_manager",
        LARGE_DEPARTMENTS[1][0],
    ),
    LargeAccountDef(
        UUID("44b01234-76fd-4638-a97f-96919031e005"),
        "manager.it@usth.edu.vn",
        "Vũ Văn An (Trưởng nhóm An ninh mạng)",
        "department_manager",
        LARGE_DEPARTMENTS[2][0],
    ),
    LargeAccountDef(
        UUID("44b01234-76fd-4638-a97f-96919031e006"),
        "manager.triage@usth.edu.vn",
        "Nguyễn Văn Triage (Điều phối viên Tiếp nhận)",
        "department_manager",
        LARGE_DEPARTMENTS[3][0],
    ),
    LargeAccountDef(
        UUID("99e09230-76fd-4638-a97f-96919031e999"),
        "admin@usth.edu.vn",
        "Quản trị viên Hệ thống (Admin)",
        "administrator",
        None,
    ),
)


@dataclass
class SeededDataset:
    departments: dict[UUID, Department]
    users: dict[str, User]
    active_tokens: dict[str, str]
    expired_tokens: dict[str, str]
    revoked_tokens: dict[str, str]
    locked_tokens: dict[str, str]


def seed_large_dataset(
    session: Session,
    password: str = DEFAULT_LARGE_PASSWORD,
) -> SeededDataset:
    """Insert or update all 8 departments and 25+ accounts idempotently."""
    dep_map: dict[UUID, Department] = {}
    for dep_id, dep_name in LARGE_DEPARTMENTS:
        dep = session.get(Department, dep_id)
        if dep is None:
            dep = Department(id=dep_id, name=dep_name)
            session.add(dep)
        else:
            dep.name = dep_name
        dep_map[dep_id] = dep
    session.flush()

    pwd_hash = hash_password(password)
    user_map: dict[str, User] = {}
    for acc in LARGE_ACCOUNTS:
        u = session.get(User, acc.id)
        if u is None:
            u = User(
                id=acc.id,
                email=acc.email,
                display_name=acc.display_name,
                password_hash=pwd_hash,
                role=acc.role,
                department_id=acc.department_id,
                is_active=acc.is_active,
            )
            session.add(u)
        else:
            u.email = acc.email
            u.display_name = acc.display_name
            u.role = acc.role
            u.department_id = acc.department_id
            u.is_active = acc.is_active
            u.password_hash = pwd_hash
        user_map[acc.email] = u
    session.flush()

    active_tokens: dict[str, str] = {}
    expired_tokens: dict[str, str] = {}
    revoked_tokens: dict[str, str] = {}
    locked_tokens: dict[str, str] = {}

    now = datetime.now(UTC)

    for email, user in user_map.items():
        # Valid active session
        tok_valid = f"token-valid-{user.role}-{user.id.hex[:6]}-{create_session_token()}"
        sess_valid = UserSession(
            user_id=user.id,
            token_hash=hash_session_token(tok_valid),
            expires_at=now + timedelta(hours=8),
            revoked_at=None,
        )
        session.add(sess_valid)
        if user.is_active:
            active_tokens[email] = tok_valid
        else:
            locked_tokens[email] = tok_valid

        # Expired session
        tok_expired = f"token-expired-{user.id.hex[:6]}-{create_session_token()}"
        sess_expired = UserSession(
            user_id=user.id,
            token_hash=hash_session_token(tok_expired),
            expires_at=now - timedelta(hours=2),
            revoked_at=None,
        )
        session.add(sess_expired)
        expired_tokens[email] = tok_expired

        # Revoked session (logged out)
        tok_revoked = f"token-revoked-{user.id.hex[:6]}-{create_session_token()}"
        sess_revoked = UserSession(
            user_id=user.id,
            token_hash=hash_session_token(tok_revoked),
            expires_at=now + timedelta(hours=6),
            revoked_at=now - timedelta(minutes=30),
        )
        session.add(sess_revoked)
        revoked_tokens[email] = tok_revoked

    session.commit()

    return SeededDataset(
        departments=dep_map,
        users=user_map,
        active_tokens=active_tokens,
        expired_tokens=expired_tokens,
        revoked_tokens=revoked_tokens,
        locked_tokens=locked_tokens,
    )


def create_scoped_incidents_for_matrix(
    session: Session,
    dataset: SeededDataset,
) -> dict[str, Incident]:
    """Create a set of incidents belonging to different reporters and departments."""
    student_a = dataset.users["student.a@demo.invalid"]
    student_b = dataset.users["student.b@demo.invalid"]

    dept_facility = dataset.departments[LARGE_DEPARTMENTS[0][0]]
    dept_electrical = dataset.departments[LARGE_DEPARTMENTS[1][0]]
    dept_security = dataset.departments[LARGE_DEPARTMENTS[2][0]]

    handler_facility1 = dataset.users["facility.handler1@demo.invalid"]
    handler_facility2 = dataset.users["facility.handler2@demo.invalid"]
    handler_elec1 = dataset.users["electrical.handler1@demo.invalid"]

    incidents: dict[str, Incident] = {}

    # Incident 1: Reported by Student A, Department Facility, Assigned to handler_facility1
    inc1 = Incident(
        id=uuid4(),
        reporter_id=student_a.id,
        category="water_leak",
        title="Rò nước phòng 204 tòa A",
        description="Đường ống rò nước nghiêm trọng gần lối thoát hiểm.",
        building="Tòa A",
        location_detail="Phòng 204",
        department_id=dept_facility.id,
        assigned_handler_id=handler_facility1.id,
        status="in_progress",
        severity="medium",
        priority="p2",
        version=1,
        answers={"leak_amount": "small"},
    )
    session.add(inc1)
    session.flush()

    # Add comments to Incident 1: 1 public, 1 internal
    com_pub = Comment(
        id=uuid4(),
        incident_id=inc1.id,
        actor_id=handler_facility1.id,
        body="Đội bảo trì đã tiếp nhận và đang thay van khóa.",
        visibility="public",
    )
    com_int = Comment(
        id=uuid4(),
        incident_id=inc1.id,
        actor_id=handler_facility1.id,
        body="Ghi chú nội bộ: Cần yêu cầu bên cung cấp phụ tùng bảo hành.",
        visibility="internal",
    )
    session.add_all([com_pub, com_int])

    # Incident 2: Reported by Student B, Department Electrical, Assigned to handler_elec1
    inc2 = Incident(
        id=uuid4(),
        reporter_id=student_b.id,
        category="electrical_hazard",
        title="Tủ điện hành lang tầng 3 bốc khói",
        description="Có mùi khét và tiếng nổ lách tách ở tủ điện tầng 3 tòa B.",
        building="Tòa B",
        location_detail="Tầng 3",
        department_id=dept_electrical.id,
        assigned_handler_id=handler_elec1.id,
        status="in_progress",
        severity="high",
        priority="p1",
        version=1,
        answers={"danger_level": "high"},
    )
    session.add(inc2)

    # Incident 3: Reported by Student A, Facility, Assigned to handler_facility2
    # (different handler in same dept)
    inc3 = Incident(
        id=uuid4(),
        reporter_id=student_a.id,
        category="water_leak",
        title="Nứt vách kính nhà thi đấu",
        description="Vết nứt kính lan rộng sau cơn mưa lớn.",
        building="Nhà thể thao",
        location_detail="Cửa phía đông",
        department_id=dept_facility.id,
        assigned_handler_id=handler_facility2.id,
        status="assigned",
        severity="low",
        priority="p3",
        version=1,
        answers={"leak_amount": "small"},
    )
    session.add(inc3)

    # Incident 4: Reported by Student B, IT Security, Unassigned
    inc4 = Incident(
        id=uuid4(),
        reporter_id=student_b.id,
        category="phishing",
        title="Email lừa đảo giả danh phòng Đào tạo",
        description="Nhận được email yêu cầu reset mật khẩu cổng sinh viên.",
        building="Khu Hiệu bộ",
        location_detail="Online",
        department_id=dept_security.id,
        assigned_handler_id=None,
        status="reported",
        severity="high",
        priority="p2",
        version=1,
        answers={"phishing_type": "email"},
    )
    session.add(inc4)

    session.commit()

    incidents["facility_handler1"] = inc1
    incidents["electrical_handler1"] = inc2
    incidents["facility_handler2"] = inc3
    incidents["it_unassigned"] = inc4

    return incidents


def main() -> None:
    import os

    from app.db import SessionLocal

    password = os.environ.get("CIM_SEED_PASSWORD", DEFAULT_LARGE_PASSWORD)
    db = SessionLocal()
    try:
        print(f"[*] Seeding large multi-role dataset (password: {password})...")
        dataset = seed_large_dataset(db, password)
        incidents = create_scoped_incidents_for_matrix(db, dataset)
        print(
            f"[✓] Successfully seeded {len(dataset.departments)} departments, "
            f"{len(dataset.users)} users, and {len(incidents)} matrix incidents!"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
