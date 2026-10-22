# Incident data model

Model N2 hỗ trợ ba loại báo cáo MVP. SQLAlchemy model có trong `backend/app/incidents` và `backend/app/evidence`; migration `n2w2_incident_storage` tạo các bảng trên PostgreSQL. Request/response xem [API contract](api-contract.md), dữ liệu mẫu dùng chung xem [incidents.json](fixtures/incidents.json).

## Bảng dữ liệu

### `incidents`

Mỗi báo cáo là một dòng trong `incidents`. `answers` là JSONB vì câu hỏi khác nhau theo `category`; API cũng trả về một object.

| Field | Type | Quy tắc |
| --- | --- | --- |
| `id` | UUID | Server tạo; request không được gửi ID. |
| `reporter_id` | UUID | FK đến `users.id`, lấy từ session đăng nhập. |
| `category` | string | `water_leak`, `electrical_hazard` hoặc `phishing`. |
| `title`, `description`, `building` | string | Giới hạn lần lượt 5–120, 20–2000 và 1–120 ký tự. |
| `location_detail` | string hoặc null | Tối đa 200 ký tự. |
| `observed_at` | timestamptz hoặc null | Thời điểm người báo quan sát, theo UTC; không nhận thời gian tương lai. |
| `answers` | JSONB object | Câu trả lời theo `category`; từ chối field lạ. |
| `status`, `version` | string, integer | Ban đầu là `reported`, version `1`. Mỗi lần cập nhật thành công tăng version một lần; version cũ trả 409. N4 xử lý chuyển trạng thái. |
| `triage_required`, `severity`, `priority`, `department_id`, `assigned_handler_id`, `rule_evaluation`, `acknowledgment_deadline_at`, `escalation_level` | mixed | Có thể null trước khi phân loại. N3 xử lý rule/SLA, N4 xử lý phân công và vòng đời. |
| `reported_at`, `updated_at`, `assigned_at`, `acknowledged_at`, `resolved_at`, `closed_at` | timestamptz | Server ghi theo UTC và trả ISO 8601. |

API kiểm tra `answers` theo schema của từng loại. Request tạo incident không được tự đặt reporter, actor, status, priority, severity hoặc department.

### `incident_attachments`

Bảng này chỉ lưu metadata; file nằm trong private storage với `storage_key` ngẫu nhiên. Không trả key hoặc public URL. Các field gồm `id`, `incident_id`, `uploaded_by`, `storage_key`, `original_name`, `content_type`, `size_bytes`, `created_at`. Upload sau khi tạo incident, chỉ nhận PDF/PNG/JPEG, tối đa 10 MiB/file và năm file/incident.

### `idempotency_records`

Khóa chính là `(user_id, key)`; `key` lấy từ header `Idempotency-Key`. Bảng lưu SHA-256 `request_fingerprint`, `incident_id`, `created_at` và `expires_at` (sau 24 giờ). Cùng user/key/body thì trả incident cũ; đổi body với cùng key thì trả 409. Ghi idempotency record, incident và event `incident.reported` trong cùng transaction. Có thể xóa record hết hạn.

## Quy ước fixture

- `fixture_id` là tên mẫu, không phải database ID. UUID cố định chỉ dùng trong mock và test; production ID do server tạo.
- Mỗi request mẫu có một UUID `Idempotency-Key`. Chỉ dùng lại key khi body không đổi.
- Thời gian mẫu là ISO 8601 UTC (`Z`). `observed_at` không được ở tương lai; `reported_at` production do server tạo.
- Fixture không chứa người thật, credentials, secrets hay file. Evidence được upload riêng.
- `expected_evaluation` là kết quả rule để đối chiếu, không thuộc request của reporter.

## Migration và seed W2

Chạy `alembic upgrade head` trên database sạch sau migration identity/session. Revision N2 tạo `incidents` (gồm `answers` JSONB), `incident_attachments` (chỉ metadata) và `idempotency_records`. Chỉ mục `(reported_at, id)` phục vụ thứ tự danh sách; các chỉ mục có thêm `reporter_id`, `department_id` hoặc `assigned_handler_id` phục vụ phạm vi người xem. Hàng đợi triage có chỉ mục riêng cho bản ghi `triage_required=true`.

Seed chỉ tạo 30 incident giả ở trạng thái `reported`, chưa phân loại và không tạo file hoặc idempotency record. Cần có một reporter giả từ seed N1 trước khi chạy; truyền UUID của tài khoản đó để seed không sửa bảng user:

```powershell
# Từ backend/ với DATABASE_URL trỏ đến DB cần seed
.venv/Scripts/python.exe -m app.incidents.seed --reporter-id <UUID-reporter>
```

Seed dùng UUID xác định từ reporter và số thứ tự. Chạy lại cùng reporter không thêm bản ghi; dùng hơn 20 incident để thử trang thứ hai với `reported_at DESC, id DESC`. Chỉ chạy trên database demo/test, không chạy trên dữ liệu thật.
