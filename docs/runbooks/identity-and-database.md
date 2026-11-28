# Tài khoản và PostgreSQL: seed, backup, restore

Các lệnh chạy từ gốc repo bằng PowerShell. Diễn tập restore trên database riêng. Không ghi mật khẩu vào Git hay tài liệu.

## Tạo tài khoản mẫu

Tạo `.env` theo README, rồi chạy:

```powershell
docker compose up -d postgres
docker compose run --rm migrate
docker compose --profile demo run --rm seed-demo
```

Seed demo tạo reporter, handler, department manager, triage manager và administrator. Mật khẩu lấy từ các biến `CIM_DEMO_*_PASSWORD` trong `.env`; chạy lại seed không tạo tài khoản trùng.

Nếu cần bộ dữ liệu lớn để thử quyền, đặt `CIM_LARGE_SEED_PASSWORD` trong phiên PowerShell, đặt `DATABASE_URL` tới database thử nghiệm, rồi chạy:

```powershell
cd backend
.venv\Scripts\python.exe -c "import os; from app.db import SessionLocal; from app.auth.seed_large import seed_large_dataset; db=SessionLocal(); seed_large_dataset(db, os.environ['CIM_LARGE_SEED_PASSWORD']); db.commit(); db.close()"
cd ..
```

## Sao lưu

Đặt `DATABASE_URL` tới database nguồn và lưu bản sao **ngoài repo**. Dừng backend và worker trước khi sao lưu nếu cần ảnh chụp nhất quán với evidence:

```powershell
cd backend
.venv\Scripts\python.exe scripts\backup_db.py --out "D:\cim-backup\database.sql.gz"
cd ..
```

Script dùng `pg_dump` trong PATH. File evidence nằm trên volume khác với PostgreSQL, nên phải sao lưu cả volume; xem [hướng dẫn dữ liệu N2](../n2-operations.md).

## Phục hồi vào database sạch

Tạo database **mới**, đặt `DATABASE_URL` tới database này và chạy:

```powershell
cd backend
.venv\Scripts\python.exe scripts\restore_db.py --input "D:\cim-backup\database.sql.gz"
.venv\Scripts\python.exe scripts\verify_restore.py
cd ..
```

`verify_restore.py` đếm phòng ban, tài khoản, kiểm bốn vai trò và xác minh mật khẩu của bộ seed lớn qua `CIM_LARGE_SEED_PASSWORD`. Nếu chỉ dùng seed demo, thử đăng nhập từng vai trò qua `POST /api/v1/auth/login` bằng mật khẩu riêng. Sau restore, kiểm tra inventory evidence theo hướng dẫn N2 trước khi mở backend.
