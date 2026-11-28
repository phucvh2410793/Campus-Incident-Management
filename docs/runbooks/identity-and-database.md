# Runbook: Quản lý Danh tính, Seed dữ liệu & Sao lưu/Khôi phục PostgreSQL

> **Chủ quản:** Vị trí N1 — Tài khoản, quyền & nền dữ liệu  
> **Áp dụng cho:** Môi trường phát triển, CI/CD, kiểm thử và diễn tập khôi phục thảm họa (Disaster Recovery).

Tài liệu này cung cấp quy trình vận hành từng bước giúp bất kỳ thành viên nào trong nhóm hoặc người đánh giá có thể **dựng sạch môi trường từ đầu, thực hiện sao lưu/khôi phục cơ sở dữ liệu PostgreSQL, và đăng nhập thành công với đầy đủ 4 vai trò**.

---

## 1. Thiết lập biến môi trường và Seed danh tính

### 1.1 Cấu hình bảo mật ngoài Git
Mật khẩu và chuỗi kết nối nhạy cảm **tuyệt đối không commit lên Git**.
Sao chép `.env.example` thành `.env` tại thư mục gốc:

```bash
cp .env.example .env
```

Trên macOS/Linux, tạo mật khẩu ngẫu nhiên cho các tài khoản demo bằng lệnh:
```bash
openssl rand -hex 32
```
Điền vào các biến `CIM_DEMO_REPORTER_PASSWORD`, `CIM_DEMO_HANDLER_PASSWORD`, `CIM_DEMO_MANAGER_PASSWORD`, `CIM_DEMO_ADMIN_PASSWORD`, `CIM_DEMO_TRIAGE_MANAGER_PASSWORD` trong file `.env`.

### 1.2 Chạy migration tạo cấu trúc bảng sạch
```bash
cd backend
# Cấp URL database PostgreSQL mục tiêu
DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:5432/campus_incident" .venv/bin/alembic upgrade head
```

### 1.3 Khởi tạo tài khoản danh tính (Seed Identities)

Dự án hỗ trợ 2 chế độ seed danh tính:
1. **Seed Demo cơ bản (5 vai trò chuẩn):**
   ```bash
   python -m app.auth.seed_demo
   ```
2. **Seed Dữ liệu lớn (8 phòng ban, 25+ tài khoản đa vai trò và session):**
   ```python
   from app.auth.seed_large import seed_large_dataset
   from app.db import SessionLocal

   with SessionLocal() as db:
       seed_large_dataset(db, "Demo-Large-Seed-2026!")
   ```

---

## 2. Quy trình Sao lưu PostgreSQL (Backup Runbook)

### 2.1 Phương pháp 1: Sử dụng Script tự động hóa
Script tích hợp tự động dọn dẹp và đặt tên file theo timestamp:
```bash
python backend/scripts/backup_db.py --db-url "postgresql://postgres:postgres@localhost:5432/campus_incident"
```
*File sao lưu mặc định được lưu tại: `backups/campus_incident_backup_YYYYMMDD_HHMMSS.sql`.*

### 2.2 Phương pháp 2: Sử dụng lệnh `pg_dump` trực tiếp
Lệnh chuẩn để trích xuất đầy đủ schema, dữ liệu, indexes và constraints:
```bash
pg_dump \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -d "postgresql://postgres:postgres@localhost:5432/campus_incident" \
  -f "backups/campus_incident_manual_backup.sql"
```

Đối với môi trường Docker Compose:
```bash
docker compose exec -T db pg_dump -U campus -d campus_incident_management --clean --if-exists > backups/docker_backup.sql
```

---

## 3. Quy trình Phục hồi PostgreSQL trên Database sạch (Restore Runbook)

Khi cần phục hồi thảm họa, kiểm thử bản build mới hoặc triển khai trên máy sạch:

### Bước 1: Tạo cơ sở dữ liệu đích hoàn toàn sạch
```bash
# Xóa database cũ nếu tồn tại (cẩn trọng trong môi trường production)
dropdb --if-exists -U postgres campus_incident_clean

# Tạo database mới trống hoàn toàn
createdb -U postgres campus_incident_clean
```

### Bước 2: Phục hồi từ bản sao lưu

**Sử dụng script phục hồi:**
```bash
python backend/scripts/restore_db.py \
  --input "backups/campus_incident_backup_YYYYMMDD_HHMMSS.sql" \
  --db-url "postgresql://postgres:postgres@localhost:5432/campus_incident_clean"
```

**Hoặc dùng lệnh `psql` trực tiếp:**
```bash
psql -d "postgresql://postgres:postgres@localhost:5432/campus_incident_clean" -f "backups/campus_incident_backup_YYYYMMDD_HHMMSS.sql"
```

Đối với môi trường Docker Compose:
```bash
cat backups/docker_backup.sql | docker compose exec -T db psql -U campus -d campus_incident_management
```

---

## 4. Kiểm tra & Xác minh sau khôi phục (Post-Restore Verification)

Sau khi khôi phục, bắt buộc chạy kiểm thử xác minh để đảm bảo:
1. Đầy đủ các bảng dữ liệu (`users`, `departments`, `user_sessions`, `incidents`, `comments`, v.v.).
2. Không bị mất mát dữ liệu hoặc lỗi ràng buộc khóa ngoại (Foreign Key Integrity).
3. Đầy đủ **cả 4 vai trò bắt buộc** và có thể **đăng nhập thành công ngay lập tức**.

### 4.1 Chạy Script kiểm tra tự động
```bash
python backend/scripts/verify_restore.py \
  --db-url "postgresql://postgres:postgres@localhost:5432/campus_incident_clean" \
  --password "Demo-Large-Seed-2026!"
```

**Kết quả kỳ vọng:**
```text
[*] Verifying database at localhost:5432/campus_incident_clean...
[i] Found 8 departments and 25 users.
[✓] All 4 mandatory roles present: {'administrator', 'department_manager', 'handler', 'reporter'}
[✓] Role 'administrator' active user 'admin@demo.invalid' authenticated successfully!
[✓] Role 'department_manager' active user 'facility.manager@demo.invalid' authenticated successfully!
[✓] Role 'handler' active user 'facility.handler1@demo.invalid' authenticated successfully!
[✓] Role 'reporter' active user 'student.a@demo.invalid' authenticated successfully!
```

### 4.2 Kiểm tra qua API thật
Khởi chạy backend kết nối với database đã khôi phục và kiểm tra API đăng nhập:
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "reporter@demo.invalid", "password": "Demo-Large-Seed-2026!"}'
```

*Phản hồi HTTP 200 trả về `access_token` và thông tin người dùng xác nhận hệ thống đã khôi phục hoàn chỉnh.*
