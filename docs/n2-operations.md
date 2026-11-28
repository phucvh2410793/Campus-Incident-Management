# N2: kiểm tra và khôi phục dữ liệu

Tài liệu này dùng cho API tiếp nhận incident, history và evidence. Các lệnh thử nghiệm chỉ chạy trên database riêng; không dùng dữ liệu thật của trường.

## W8: kiểm tra khi automation tắt

`POST /api/v1/incidents` xác thực qua policy N1, ghi incident, idempotency record và `incident.reported` vào outbox trong cùng transaction. Nếu n8n/worker chưa chạy, API vẫn trả 201, event ở trạng thái `pending`; gửi lại cùng key/body trả 200 và không thêm event. Nếu ghi outbox lỗi, toàn bộ transaction rollback. Các trường hợp này có trong `backend/tests/test_incident_create_api.py` và `backend/tests/test_n2_w8_w10.py`.

Việc đưa event qua n8n và nhận kết quả phân loại là phần tích hợp N5/N3 ở W8; không coi riêng test N2 là bằng chứng cho luồng đó.

## W9: đo trên seed lớn

Chỉ chạy benchmark trên database bỏ đi tên `campus_incident_bench`. Sau `alembic upgrade head`:

```powershell
# Từ backend/, DATABASE_URL trỏ tới campus_incident_bench
.venv\Scripts\python.exe -m app.incidents.benchmark --rows 10000 --samples 30
```

Script chặn database có tên khác. Nó tạo 10.000 incident giả chia giữa hai reporter, chạy `ANALYZE`, đo cả service/DB và HTTP API cho create và trang danh sách 20 bản ghi, kiểm tra scope, rồi in JSON kèm `EXPLAIN (ANALYZE, BUFFERS)`. Database benchmark giữ dữ liệu sau khi chạy; xóa toàn bộ database bỏ đi khi kết thúc. Cần cài `requirements-dev.txt` để chạy HTTP benchmark bằng `TestClient`.

Số đo ngày 26/11/2026: Windows 11, Python 3.14.7, PostgreSQL 17.9 trong Docker, 10.000 incident, 30 mẫu. Median/p95 tính bằng ms:

| Thao tác service + DB | Median | P95 |
| --- | ---: | ---: |
| Tạo incident và outbox | 8,219 | 10,366 |
| Danh sách reporter, trang đầu 20 bản ghi | 2,265 | 2,902 |
| Danh sách reporter lọc `water_leak` | 2,412 | 2,990 |
| HTTP `POST /incidents` | 12,384 | 16,861 |
| HTTP `GET /incidents?limit=20` | 8,495 | 16,489 |

Query plan dùng `Index Scan Backward` trên `ix_incidents_reported_at_id`; 20 dòng đầu đọc từ 3 shared buffers. Chưa thêm index vì trên cỡ mẫu này truy vấn đã dùng index và thời gian thấp. Các số HTTP đo bằng FastAPI `TestClient` trên cùng máy, chưa gồm mạng/browser và không phải cam kết hiệu năng triển khai.

## W10: regression dữ liệu và file

```powershell
# Từ backend/, TEST_DATABASE_URL phải trỏ tới campus_incident_test đã migrate
.venv\Scripts\python.exe -m pytest -q tests/test_incident_create_api.py tests/test_incident_read_api.py tests/test_n2_w6_w7_api.py tests/test_n2_w8_w10.py
```

Test kiểm tra rollback khi outbox lỗi, replay idempotency, 409 khi hai supplement cùng version, quyền 404 chéo reporter, upload sai loại/cỡ/chữ ký, file mồ côi và inventory. Văn bản có `<script>` được trả bằng JSON, không trả HTML. PDF chứa các marker hành động phổ biến như `/JavaScript` hoặc `/OpenAction` bị chặn; file tải xuống có `Content-Disposition: attachment`, `nosniff` và CSP `sandbox`. Kiểm tra marker không thay thế một bộ quét PDF chuyên dụng, nên không dùng file không tin cậy cho môi trường thật chỉ dựa vào kiểm tra này.

## W11: backup và thử restore incident/evidence

PostgreSQL chỉ giữ metadata; bytes file nằm trong volume `evidence_data`. Backup DB mà quên volume sẽ làm mất bằng chứng. Chọn một thư mục backup **ngoài repo**, chỉ người quản trị được đọc. Tạm dừng backend, frontend và worker outbox để không có ghi mới trong lúc chụp hai nguồn:

```powershell
# Từ gốc repo; đặt $backup thành đường dẫn ngoài repo của bạn
New-Item -ItemType Directory -Force -Path "$backup\evidence" | Out-Null
docker compose stop frontend backend
# Dừng process app.automation.run_worker nếu đang chạy riêng.
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/cim-n2.dump'
docker compose cp postgres:/tmp/cim-n2.dump "$backup\database.dump"
docker compose cp backend:/app/private_evidence/. "$backup\evidence"
```

Sau khi copy, đặt `DATABASE_URL` trỏ vào DB nguồn qua cổng host, `EVIDENCE_DIR` trỏ tới `$backup\evidence`, rồi tạo inventory:

```powershell
cd backend
$env:EVIDENCE_DIR = "$backup\evidence"
.venv\Scripts\python.exe -m app.evidence.inventory --write "$backup\inventory.json"
cd ..
docker compose start backend frontend
```

Giữ `database.dump`, thư mục `evidence` và `inventory.json` cùng một bộ backup. Inventory lưu ID/key/hash SHA-256, không chứa nội dung file, nhưng vẫn là metadata riêng tư; không commit lên Git.

Để thử restore, tạo **database trống** `campus_incident_restore` và thư mục evidence trống, phục hồi dump vào đó. Không chạy `pg_restore` lên DB đang phục vụ ứng dụng:

```powershell
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" campus_incident_restore'
docker compose cp "$backup\database.dump" postgres:/tmp/cim-n2-restore.dump
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d campus_incident_restore --no-owner --no-privileges /tmp/cim-n2-restore.dump'
```

Copy evidence từ backup sang thư mục trống; đặt `DATABASE_URL` trỏ tới `campus_incident_restore` và `EVIDENCE_DIR` trỏ tới thư mục evidence đã phục hồi. Sau đó chạy:

```powershell
cd backend
.venv\Scripts\python.exe -m app.evidence.inventory --verify "$backup\inventory.json"
```

Lệnh verify so số incident, ID attachment, storage key, kích thước và SHA-256 của từng file; thiếu, sửa hoặc thừa file đều báo lỗi. Ngày 26/11/2026 đã thử trên hai PostgreSQL database sạch với một incident và một file PDF: restore và verify đều đạt. N1 phụ trách runbook backup toàn bộ tài khoản/session; N2 kiểm tính nhất quán incident/evidence trong bản khôi phục.

## W12: bàn giao N2

Chạy lại toàn bộ test backend, `ruff check`, `ruff format --check`, `alembic check` và luồng reporter thật sau khi N6 thay mock bằng API. Khi N3/N4/N5 merge W8–W12, kiểm lại quyền, trạng thái, history và outbox trên bản `main` mới. Chỉ đóng băng API khi luồng tạo → upload → bổ sung → xem lại chạy với DB thật.
