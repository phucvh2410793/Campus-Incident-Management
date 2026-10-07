# Thiết lập môi trường phát triển

## Công cụ

- Docker Desktop với Linux containers và Docker Compose để chạy toàn bộ stack.
- Node.js 24 + npm cho frontend chạy trực tiếp.
- Python 3.14 cho backend chạy trực tiếp và kiểm thử.
- Git để quản lý source. Repository chưa có remote; nhóm cần thêm URL repo thật.

Frontend có `package-lock.json`; backend có dependency được cố định trong `requirements.txt` và `requirements-dev.txt`. Khi nâng phiên bản, chạy lại kiểm tra và review thay đổi lock/config.

## Chạy toàn bộ bằng Docker

Tại thư mục gốc, mở Docker Desktop và đợi engine sẵn sàng:

```powershell
docker version
powershell -ExecutionPolicy Bypass -File scripts/init-env.ps1
docker compose config --quiet
docker compose up --build -d --wait
powershell -ExecutionPolicy Bypass -File scripts/verify-docker.ps1
```

Script tạo `.env` bằng giá trị ngẫu nhiên dạng hex để password có thể dùng trong URL database; không ghi đè file đã tồn tại. Không chia sẻ `.env` lên Git. Với macOS/Linux, sao chép `.env.example` thành `.env`, thay hai placeholder bằng chuỗi hex ngẫu nhiên, ví dụ tạo riêng từng giá trị bằng `openssl rand -hex 32`.

Compose chạy PostgreSQL trước, migration kế tiếp, rồi backend và frontend. n8n chạy độc lập. Nếu migration lỗi, backend không được khởi động; kiểm tra log thay vì bỏ qua migration.

| Dịch vụ | Địa chỉ trên máy phát triển |
| --- | --- |
| Frontend | http://localhost:5173 |
| API docs | http://localhost:8000/docs |
| API liveness | http://localhost:8000/api/v1/health/live |
| API database readiness | http://localhost:8000/api/v1/health/ready |
| n8n | http://localhost:5678 |
| PostgreSQL | localhost:15432 |

Cổng PostgreSQL trên máy mặc định là `15432` để tránh xung đột với dịch vụ đang dùng `5432`. Đổi `POSTGRES_PORT` ở root `.env` và URL trong `backend/.env` đồng bộ nếu chạy backend trực tiếp. Cổng giữa container vẫn là `5432`.

Frontend là Vite dev server trong cấu hình này. Image frontend hiện không phải bản deploy production. n8n yêu cầu tạo owner account ở lần truy cập đầu tiên; chưa có tài khoản demo mặc định.

## Frontend chạy trực tiếp

```powershell
cd frontend
npm ci
npm run dev
```

Vite chuyển `/api` đến `http://127.0.0.1:8000`. Đổi `API_PROXY_TARGET` trong `frontend/.env` nếu backend ở địa chỉ khác. Biến này chỉ dùng bởi dev server; không đưa secrets vào biến `VITE_*` vì chúng có thể được bundle vào trình duyệt.

## Backend chạy trực tiếp

Khởi động PostgreSQL qua Compose trước; không chạy đồng thời hai backend trên cổng 8000:

```powershell
# Từ thư mục gốc sau khi tạo .env
docker compose up -d postgres
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Sửa DATABASE_URL trong backend/.env để khớp user/password/database ở root .env.
.venv/Scripts/alembic.exe upgrade head
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Lệnh sao chép env chỉ thực hiện khi file chưa có; giữ cấu hình đã sửa trong lần chạy sau. Linux/macOS dùng `python3 -m venv .venv`, `.venv/bin/python`, `.venv/bin/alembic` và `.venv/bin/ruff`.

Liveness chạy được khi chưa có PostgreSQL. Readiness trả HTTP 503 nếu không kết nối database; không trả chi tiết chứa password. Hiện readiness kiểm tra kết nối, chưa kiểm tra toàn bộ chức năng nghiệp vụ.

## Kiểm tra

```powershell
# Từ frontend/
npm run lint
npm run build

# Từ backend/
.venv/Scripts/ruff.exe check .
.venv/Scripts/ruff.exe format --check .
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/alembic.exe upgrade head --sql
```

`--sql` chỉ sinh SQL, không chứng minh migration đã chạy trên PostgreSQL. Khi database đã chạy, kiểm tra thêm:

```powershell
.venv/Scripts/alembic.exe upgrade head
.venv/Scripts/alembic.exe current
.venv/Scripts/alembic.exe check
```

Chỉ chạy kiểm tra downgrade trên database thử nghiệm riêng; không chạy trên dữ liệu nhóm đang dùng.

## Smoke check HTTP không cần Docker

Từ thư mục gốc, sau khi cài dependencies frontend và backend:

```powershell
backend/.venv/Scripts/python.exe scripts/smoke-check.py
```

Script mở API/Vite tạm thời trên cổng 18100/15173, kiểm tra HTML và proxy `/api`, rồi dừng hai process. Hai cổng này phải đang trống. Kiểm tra này không chứng minh giao diện đã render trong trình duyệt hoặc DB đã sẵn sàng.

## Log, dừng và troubleshooting

```powershell
# Từ thư mục gốc
docker compose logs --tail 100 backend migrate postgres
docker compose logs --tail 100 n8n
docker compose down
```

`down` giữ các named volume. Không dùng `down -v` nếu cần giữ dữ liệu. Backup/restore production chưa được triển khai; các mảng N1 (PostgreSQL), N2 (evidence) và N5 (n8n) phải thử khôi phục ở W11 theo [kế hoạch](KE_HOACH_CONG_VIEC.md) trước khi sử dụng dữ liệu thật.

| Vấn đề | Kiểm tra |
| --- | --- |
| Không kết nối Docker engine | Mở Docker Desktop, chọn Linux containers, chạy lại `docker version` |
| Compose yêu cầu biến môi trường | Chạy script tạo `.env`; kiểm tra đúng thư mục gốc |
| Cổng đã bị chiếm | Kiểm tra ứng dụng trên 5173/8000/15432/5678; dừng instance trùng hoặc cập nhật port/proxy đồng bộ |
| Readiness trả 503 | Kiểm tra PostgreSQL, credentials và URL host/container |
| Đổi password trong .env nhưng DB vẫn dùng password cũ | Volume PostgreSQL đã được khởi tạo; đổi password trong DB và config đồng bộ, không xóa volume tùy tiện |
| Frontend báo API offline | Kiểm tra backend liveness và Vite proxy; nếu build preview thì không có proxy dev server |
| Workflow không gọi được backend | Bên trong Compose dùng `http://backend:8000`, không dùng localhost |

`npm run preview` chỉ xem build tĩnh; `/api` chưa có proxy production. Để thử luồng frontend/API hiện tại, dùng `npm run dev` hoặc Compose.
