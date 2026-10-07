# API contract — Campus Incident Management

**Trạng thái:** đặc tả để triển khai, không phải danh sách endpoint đã chạy. Source hiện chỉ có `GET /api/v1/health/live`, `GET /api/v1/health/ready`, `/docs` và `/openapi.json`. Frontend/backend/n8n phải dùng hợp đồng dưới đây; khi triển khai cần cập nhật OpenAPI sinh từ FastAPI và giữ ví dụ trong tài liệu đồng bộ với test.

Phạm vi nghiệp vụ, ma trận quyền, rule `demo-v1` và SLA demo nằm trong [đặc tả phần A](phan-a-yeu-cau-nghiep-vu.md). Đây là hệ thống **demo bằng dữ liệu giả**, không phải API ứng cứu chính thức của trường.

## 1. Quy ước chung

| Mục | Hợp đồng |
| --- | --- |
| Base URL | `/api/v1`; mọi endpoint bên dưới dùng prefix này, trừ health/OpenAPI có đường dẫn ghi rõ. |
| Nội dung | JSON UTF-8 `application/json`; upload riêng dùng `multipart/form-data`; download trả stream với `Content-Disposition: attachment`. |
| ID | UUID dạng chuỗi; client không tự chọn `reporter_id`, `actor_id`, `department_id` từ phiên hoặc vai trò. |
| Thời gian | ISO 8601 UTC có `Z`, ví dụ `2026-11-02T09:30:00Z`; input `observed_at` không được ở tương lai. |
| Enum trên dây | `category`: `water_leak`, `electrical_hazard`, `phishing`; `status`: `reported`, `assigned`, `in_progress`, `resolved`, `closed`; `severity`: `low`, `medium`, `high`, `critical`; `priority`: `p1`, `p2`, `p3`. Phần A dùng tên hiển thị viết hoa cho cùng giá trị. |
| Chưa phân loại | `severity`, `priority`, `department_id`, `rule_evaluation` có thể `null`; `triage_required=true`. Không dùng `p3` như giá trị mặc định. |
| Version | Mỗi incident có `version` nguyên dương. Mọi thao tác thay đổi một incident đã tồn tại gửi `expected_version`; nếu không khớp trả `409 version_conflict` và không ghi gì. |
| Phân trang | `limit` mặc định 20, tối đa 100; `cursor` opaque. Sắp xếp danh sách theo `reported_at DESC, id DESC`. Response có `items`, `next_cursor` (`null` khi hết). Cursor không được dùng để vượt phạm vi quyền. |
| Correlation | Mỗi response có `X-Request-ID`; client có thể gửi `X-Request-ID` dạng UUID, backend tự tạo nếu thiếu/sai. Log dùng ID này, không log token hoặc bằng chứng. |
| Rate limit | Login tối đa 5 lần sai trong 15 phút theo cặp email/IP demo; trả `429`. Upload và endpoint nội bộ cũng có giới hạn cấu hình. |
| Môi trường | Localhost HTTP chỉ cho phát triển. Public deployment bắt buộc HTTPS và cấu hình CORS/origin riêng; không dùng cấu hình Compose hiện tại để public. |

Các field ngoài hợp đồng bị từ chối bằng `422`, đặc biệt `reporter_id`, `actor_id`, `status`, `priority`, `severity`, `department_id` trong request tạo báo cáo. Client không được quyết định quyền hoặc kết quả rule.

### Lỗi chung

Mọi lỗi nghiệp vụ dùng cùng dạng sau (kể cả validation 422, thay vì body mặc định khác của FastAPI):

```json
{
  "error": {
    "code": "version_conflict",
    "message": "Bản ghi đã thay đổi. Hãy tải lại trước khi tiếp tục.",
    "details": [{"field": "expected_version", "reason": "stale"}],
    "request_id": "9c23fa93-756a-45c7-805b-96d9094b908d"
  }
}
```

| HTTP | Khi dùng | `error.code` ví dụ |
| --- | --- | --- |
| 400 | Request sai cấu trúc/thiếu header bắt buộc | `bad_request`, `missing_idempotency_key` |
| 401 | Không có token, token sai/hết hạn/đã thu hồi | `unauthenticated` |
| 403 | Đã biết tài nguyên nhưng hành động không thuộc quyền vai trò | `forbidden` |
| 404 | Không có tài nguyên **hoặc** người gọi không có quyền biết bản ghi tồn tại | `not_found` |
| 409 | Version cũ, transition không hợp lệ, key lặp khác payload, trạng thái không phù hợp | `version_conflict`, `invalid_transition`, `idempotency_conflict` |
| 413 | File vượt dung lượng | `file_too_large` |
| 415 | Nội dung file/Content-Type không được phép | `unsupported_media_type` |
| 422 | Field sai/thiếu, form theo loại không hợp lệ | `validation_error` |
| 429 | Quá giới hạn thử đăng nhập/gửi | `rate_limited` |
| 503 | Database hoặc thành phần bắt buộc cho request không sẵn sàng | `service_unavailable` |

Với ID incident/file không thuộc phạm vi xem của người dùng, luôn trả 404 và cùng thông điệp như ID không tồn tại. Nếu người đó xem được incident nhưng không được thao tác (ví dụ reporter đóng sự cố), trả 403. Frontend không suy ra sự tồn tại của bản ghi từ mã lỗi hoặc thời gian phản hồi.

## 2. Xác thực và quyền

**Quyết định demo:** dùng opaque bearer token cho API người dùng. Login tạo token ngẫu nhiên, chỉ trả bản gốc một lần; backend lưu **hash** token, `user_id`, `expires_at`, `revoked_at`, `created_at` trong bảng session. Token có TTL 8 giờ; không có refresh endpoint. Frontend giữ token trong bộ nhớ ứng dụng, không lưu `localStorage`, `sessionStorage`, cookie hoặc log. Tải lại trang phải đăng nhập lại. Logout thu hồi session; vô hiệu user làm mọi session không còn hiệu lực. Với bearer header, trình duyệt không tự gửi credential như cookie nên bản demo không dùng CSRF token. Mật khẩu được băm bằng thuật toán password hashing phù hợp (Argon2id được đề xuất), không lưu hay trả plaintext.

Header cho endpoint người dùng: `Authorization: Bearer <token>`. `GET /auth/me` là nguồn thông tin role/department cho UI, nhưng backend luôn kiểm tra lại trên từng request. Vai trò wire: `reporter`, `handler`, `department_manager`, `administrator`. Admin **không mặc định** đọc được incident/file.

| Method | Path | Ai gọi | Request | Thành công |
| --- | --- | --- | --- | --- |
| POST | `/auth/login` | Chưa đăng nhập | `{ "email": string, "password": string }` | 200: `{ "access_token": string, "token_type": "bearer", "expires_at": UTC, "user": UserSummary }` |
| GET | `/auth/me` | Mọi user đã đăng nhập | Không body | 200: `UserSummary` |
| POST | `/auth/logout` | Mọi user đã đăng nhập | Không body | 204, thu hồi token hiện tại |

`UserSummary`: `id`, `display_name`, `email`, `role`, `department_id`, `is_active`; không có `password_hash`. Login sai email hoặc mật khẩu đều trả `401 invalid_credentials` với cùng thông điệp. Tài khoản bị khóa không được tạo session. Session hết hạn/thu hồi trả 401.

### Quyền theo hành động

| Hành động | Reporter | Handler | Department manager | Administrator |
| --- | --- | --- | --- | --- |
| Tạo/xem/bổ sung báo cáo | Của mình | Của mình khi là reporter; xem incident được giao | Xem incident của bộ phận | Không mặc định |
| Xem/tạo comment công khai | Của mình | Incident được giao | Incident của bộ phận | Không mặc định |
| Xem/tạo ghi chú nội bộ | Không | Incident được giao | Incident của bộ phận | Không mặc định |
| Download/upload bằng chứng | Của incident mình được xem | Incident được giao | Incident của bộ phận | Không mặc định |
| Phân công/đổi priority/đóng/mở lại | Không | Không | Incident của bộ phận, có lý do | Không mặc định |
| Nhận và giải quyết | Không | Incident được giao | Incident của bộ phận | Không mặc định |
| Quản lý user/department/rule/event lỗi | Không | Không | Không | Có audit |

Manager có thể chuyển incident sang bộ phận khác chỉ khi đang quản lý bộ phận hiện tại; bộ phận đích phải hợp lệ. Handler mất quyền thao tác khi assignment chuyển sang người khác. Comment `public` chỉ là hiển thị cho các vai trò **có quyền đối với incident**, không phải endpoint công khai.

Hàng đợi `triage_required` dùng một bộ phận nội bộ `triage_queue` với manager demo được chỉ định; đó **không phải** bộ phận xử lý cuối. Incident vẫn ở `reported`, `priority=null` và chưa có handler cho đến khi manager phân công đúng bộ phận. Manager của hàng đợi này được gọi `/assign` để chuyển khỏi triage; không cần quyền admin xem toàn bộ incident.

## 3. Incident và form

### Dữ liệu tạo báo cáo

`POST /incidents` dùng header `Idempotency-Key: <UUID>`; khóa scoped theo user, giữ 24 giờ. Cùng key + cùng body trả lại incident cũ với 200; cùng key + body khác trả 409. Lần đầu thành công trả 201 và header `Location: /api/v1/incidents/{id}`. Incident, idempotency record và outbox event `incident.reported` phải commit cùng một transaction. n8n ngừng hoạt động không làm request này thất bại nếu PostgreSQL còn hoạt động.

```json
{
  "category": "water_leak",
  "title": "Rò nước ở hành lang tầng 2",
  "description": "Nước chảy từ trần gần cửa phòng học, sàn đang ướt.",
  "building": "Tòa A",
  "location_detail": "Tầng 2, gần phòng 205",
  "observed_at": "2026-11-02T09:20:00Z",
  "answers": {"leak_amount": "small", "near_electricity": "no", "slip_risk": true}
}
```

Trường chung: `title` 5–120 ký tự, `description` 20–2000, `building` 1–120, `location_detail` tối đa 200 hoặc `null`, `observed_at` UTC hoặc `null`. Reporter lấy từ token, không nhận từ body. `answers` phải đúng schema theo category:

| Category | Field bắt buộc | Giá trị | Tùy chọn |
| --- | --- | --- | --- |
| `water_leak` | `leak_amount`, `near_electricity` | `small/large/unknown`, `yes/no/unknown` | `slip_risk`: boolean hoặc null |
| `electrical_hazard` | `exposed_wire`, `smoke_or_sparks` | Mỗi field: `yes/no/unknown` | `equipment`: chuỗi tối đa 200 hoặc null |
| `phishing` | `interaction`, `channel` | `none/clicked_link/entered_information/unknown`; `email/message/other` | `sender_text`: chuỗi tối đa 254 hoặc null |

Không nhận mật khẩu, OTP hoặc raw email chứa bí mật. Field `unknown` hợp lệ nhưng có thể dẫn tới `triage_required=true`, không phải 422. Field không có trong schema bị 422. File được upload **sau khi** incident tạo thành công ở endpoint riêng; lỗi upload không xóa incident và UI phải báo rõ tình trạng từng file.

### IncidentResponse

```json
{
  "id": "2ee24992-34d3-4955-9e5c-f7446fd42393",
  "version": 1,
  "category": "water_leak",
  "title": "Rò nước ở hành lang tầng 2",
  "description": "Nước chảy từ trần gần cửa phòng học, sàn đang ướt.",
  "building": "Tòa A",
  "location_detail": "Tầng 2, gần phòng 205",
  "observed_at": "2026-11-02T09:20:00Z",
  "answers": {"leak_amount": "small", "near_electricity": "no", "slip_risk": true},
  "reporter_id": "22e09230-76fd-4638-a97f-96919031e40b",
  "status": "reported",
  "triage_required": false,
  "severity": null,
  "priority": null,
  "department_id": null,
  "assigned_handler_id": null,
  "rule_evaluation": null,
  "reported_at": "2026-11-02T09:30:00Z",
  "assigned_at": null,
  "acknowledged_at": null,
  "resolved_at": null,
  "closed_at": null,
  "acknowledgment_deadline_at": null,
  "escalation_level": 0
}
```

`rule_evaluation` sau xử lý có `{rule_id, rule_version, reason}`; không chứa chi tiết nội bộ nhạy cảm. Reporter chỉ nhận trường công khai của incident, `rule_evaluation` và timeline public; không nhận ghi chú nội bộ, dữ liệu service/outbox hoặc email người xử lý nếu chưa được phép. Staff nhận thêm field nghiệp vụ theo phạm vi quyền. Không trả raw `password_hash`, token, địa chỉ lưu file hay nội dung log.

Ở thời điểm vừa tạo, `department_id=null` và UI hiển thị đang chờ tự động hóa. Nếu rule không khớp, kết quả đánh giá cập nhật `triage_required=true`, `department_id=<triage_queue_id>`, giữ `status=reported` và `priority=null`; manager triage nhận cảnh báo review riêng. Giá trị `department_id` này chỉ là hàng đợi, không được diễn giải là đã phân công người xử lý.

### Endpoint đọc/bổ sung

| Method | Path | Quyền | Request / query | Response |
| --- | --- | --- | --- | --- |
| GET | `/incidents` | User đã đăng nhập, giới hạn theo bản ghi | `limit`, `cursor`, `status`, `category`, `priority`, `department_id`, `triage_required`, `overdue` (filter chỉ trả tập con được xem) | 200: `{items: IncidentSummary[], next_cursor: string|null}` |
| GET | `/incidents/{incident_id}` | Người được xem bản ghi | Không body | 200: `IncidentResponse` theo phạm vi quyền |
| POST | `/incidents/{incident_id}/supplements` | Reporter của incident khi chưa `resolved/closed` | `{ "text": string(1..2000), "expected_version": int }` | 201: `{id, created_at, incident_version}`; tạo history public |
| GET | `/incidents/{incident_id}/history` | Người được xem bản ghi | `limit`, `cursor` | 200: `{items: HistoryItem[], next_cursor}`; reporter chỉ thấy event public |

`IncidentSummary`: `id`, `version`, `category`, `title`, `status`, `priority`, `triage_required`, `department_id` (nếu được phép), `reported_at`, `acknowledgment_deadline_at`, `overdue`. `overdue` chỉ đúng nếu chưa acknowledged và đã qua deadline; `triage_required` có cảnh báo review riêng, không giả SLA P1. `HistoryItem`: `id`, `action`, `actor_display_name` hoặc `"Hệ thống"`, `created_at`, `visibility`, `details` đã lọc theo quyền. Cursor phải ổn định khi thêm incident mới giữa hai trang.

## 4. File, comment và thao tác trạng thái

### Bằng chứng

| Method | Path | Quyền | Request | Response |
| --- | --- | --- | --- | --- |
| POST | `/incidents/{incident_id}/attachments` | Reporter của incident chưa đóng; handler/manager trong phạm vi | Multipart `file` + `expected_version`; tối đa 5 file/incident, 10 MiB/file; chỉ PDF/PNG/JPEG sau khi kiểm tra nội dung thật | 201: `{id, original_name, content_type, size_bytes, created_at, incident_version}` |
| GET | `/incidents/{incident_id}/attachments` | Người được xem file của incident | Không body | 200: `{items: AttachmentSummary[]}` |
| GET | `/incidents/{incident_id}/attachments/{attachment_id}/download` | Người được xem file của incident | Không body | 200 stream; `Cache-Control: no-store`; tên file an toàn |

Upload sai không để file mồ côi. Server tạo tên lưu ngẫu nhiên, không dùng path/tên do người dùng gửi để ghép filesystem path. Không có static public URL hoặc nội dung file trong email. Vì upload là thao tác sau tạo incident, mỗi file có lỗi/success riêng và UI không báo “mọi file đã lưu” khi có file thất bại.

### Comment

| Method | Path | Quyền | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/incidents/{incident_id}/comments` | Người được xem incident | `limit`, `cursor` | 200: `{items: Comment[], next_cursor}` đã lọc visibility |
| POST | `/incidents/{incident_id}/comments` | Reporter/handler/manager theo phạm vi | `{ "body": string(1..2000), "visibility": "public"|"internal", "expected_version": int }` | 201: `Comment` + `incident_version` |

Reporter chỉ tạo `public`, không xem/tạo `internal`; handler/manager tạo cả hai. Comment hiển thị dưới dạng text đã escape, không render HTML người dùng nhập.

### Hành động trên incident

Mỗi POST dưới đây bắt buộc `expected_version`; backend kiểm tra quyền, trạng thái và cập nhật incident/history/audit trong cùng transaction. Response thành công 200: `{ "incident": IncidentResponse, "history_id": UUID }` theo phạm vi quyền. Dù frontend ẩn nút, backend vẫn quyết định cuối cùng.

| Method | Path | Quyền | Body bắt buộc | Điều kiện |
| --- | --- | --- | --- | --- |
| POST | `/incidents/{id}/assign` | Manager của bộ phận hiện tại | `department_id`, `handler_id` hoặc null, `reason`, `expected_version` | Department/handler hợp lệ; `reported` chuyển `assigned`; phân công lại không tự reset `acknowledged_at`. |
| POST | `/incidents/{id}/acknowledge` | Handler được giao hoặc manager cùng bộ phận | `expected_version` | Chỉ `assigned → in_progress`; ghi `acknowledged_at` một lần. |
| POST | `/incidents/{id}/priority` | Manager của bộ phận | `priority`, `reason`, `expected_version` | Priority p1/p2/p3; tính lại deadline từ `reported_at` nếu chưa tiếp nhận, giữ escalation/history cũ. |
| POST | `/incidents/{id}/transitions` | Handler được giao hoặc manager theo bảng bên dưới | `target_status`, `reason` hoặc `resolution` theo transition, `expected_version` | Chỉ các cạnh hợp lệ; trả 409 khi cạnh sai. |
| POST | `/incidents/{id}/disposition` | Manager của bộ phận | `kind`: `duplicate`/`invalid`; `reason`; `duplicate_of_id` nếu trùng; `expected_version` | Lưu disposition/history và đóng incident; không xóa bản ghi. |

| Từ → Đến | Ai được làm | Field thêm |
| --- | --- | --- |
| `in_progress → resolved` | Handler được giao hoặc manager | `resolution` không rỗng |
| `resolved → closed` | Manager | `reason` xác nhận hoặc null |
| `resolved → in_progress` | Manager | `reason` bắt buộc |
| `closed → in_progress` | Manager | `reason` bắt buộc |

`reported → assigned` qua `/assign` hoặc API nội bộ; `assigned → in_progress` qua `/acknowledge`, không gọi `/transitions`. `disposition` chỉ dùng khi incident chưa `closed`. Các timestamp cũ/history không bị xóa khi mở lại; lần mở lại không tự tạo SLA tiếp nhận mới. Ghi nhận xung đột đồng thời bằng version check trong câu lệnh cập nhật/transaction, không chỉ kiểm tra ở frontend.

## 5. Quản trị tối thiểu và theo dõi lỗi

Các endpoint dưới đây chỉ cho `administrator`, ghi audit. Có thể làm CLI quản trị tương đương nếu nhóm chọn bỏ UI, nhưng kết quả và quyền phải giống hợp đồng. Admin không nhờ các endpoint này để xem incident/file.

| Method | Path | Request / ý nghĩa | Response |
| --- | --- | --- | --- |
| GET | `/admin/users` | `limit`, `cursor`, `role`, `department_id`, `is_active` | 200 danh sách `UserSummary` |
| POST | `/admin/users` | `email`, `display_name`, `role`, `department_id`, mật khẩu demo được cấp an toàn ngoài Git | 201 `UserSummary` |
| PATCH | `/admin/users/{id}` | `is_active` hoặc role/department hợp lệ | 200 `UserSummary`; khóa user làm session mất hiệu lực |
| GET | `/admin/departments` | Không body | 200 danh sách ID/tên |
| POST | `/admin/departments` | `name` | 201 department |
| GET | `/admin/rules` | Không body | 200 các rule/version dùng cho demo |
| POST | `/admin/rules/versions` | Bộ rule mới, version mới; không sửa ngầm rule version cũ | 201 `{version, created_at}` sau validation |
| GET | `/admin/events/failed` | `limit`, `cursor` | 200 danh sách event lỗi, số lần thử, lỗi đã che secrets |
| POST | `/admin/events/{id}/retry` | `{ "reason": string }` | 202: event vào hàng chờ; idempotent nếu đã pending/done |

Không trả mật khẩu ban đầu trong list/read; nếu cần cấp mật khẩu demo, thao tác chỉ hiển thị một lần cho người quản trị hoặc dùng CLI nhập qua biến môi trường. Không gửi mật khẩu qua email.

## 6. Hợp đồng backend ↔ n8n và độ tin cậy

n8n không gọi các endpoint user. Backend dispatcher gửi outbox event đến webhook n8n **nội bộ Docker**. Header `X-CIM-Event-ID: <UUID>`, `X-CIM-Timestamp: <Unix seconds>`, `X-CIM-Signature: sha256=<hex HMAC-SHA256>`; chữ ký tính trên chuỗi `<timestamp>.<raw_request_body>` bằng secret riêng ngoài Git. n8n từ chối chữ ký sai, timestamp lệch quá 5 phút; event ID là khóa idempotency. Dùng HTTPS nếu webhook ra khỏi mạng nội bộ. N8n gọi ngược backend bằng service bearer token riêng, chỉ cấp quyền cho `/internal/*`; backend lưu hash token, hỗ trợ xoay vòng và không dùng token người dùng.

```json
{
  "event_id": "d69996e8-ae76-44d4-a396-41694498feb3",
  "event_type": "incident.reported",
  "incident_id": "2ee24992-34d3-4955-9e5c-f7446fd42393",
  "occurred_at": "2026-11-02T09:30:00Z",
  "schema_version": 1,
  "request_id": "9c23fa93-756a-45c7-805b-96d9094b908d"
}
```

Payload không chứa mô tả/file/ghi chú nhạy cảm. n8n phải truy vấn API nội bộ để lấy metadata tối thiểu. Backend/outbox có `pending`, `processing`, `done`, `failed`; worker claim event bằng lock/lease, tăng `attempt_count`, retry với backoff giới hạn, giữ lỗi đã che secrets và cho admin retry có lý do. HTTP 2xx từ webhook nghĩa là n8n **đã nhận event**, không chứng minh toàn bộ workflow đã xong; n8n gọi API kết quả để đánh dấu `done`. Nếu lease hết hạn mà không có kết quả, worker retry. Handler n8n và backend phải idempotent với `event_id`.

| Method | Path | Quyền | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/internal/events/{event_id}` | Service n8n | Không body | 200: event type, incident ID và metadata tối thiểu; không có bằng chứng/raw secrets |
| POST | `/internal/events/{event_id}/evaluate` | Service n8n | `{ "run_id": string }` | 200: `{incident_id, status, severity, priority, department_id, rule_id, rule_version, reason, triage_required, incident_version}`; lặp cùng event trả cùng kết quả |
| POST | `/internal/events/{event_id}/complete` | Service n8n | `{ "run_id": string, "status": "done"|"failed", "error_code": string|null }` | 200: trạng thái cuối; lặp an toàn, không cho `done → failed` |
| POST | `/internal/notifications/claim` | Service n8n | `{ "event_id": UUID, "kind": string, "recipient_user_id": UUID }` | 200: `{notification_id, should_send}`; unique `(event_id, kind, recipient_user_id)` |
| POST | `/internal/notifications/{id}/complete` | Service n8n | `{ "status": "sent"|"failed"|"uncertain", "provider_message_id": string|null }` | 200: trạng thái đã ghi; không tự gửi lại `sent/uncertain` |
| POST | `/internal/sla/check` | Service n8n theo lịch | Không body | 200: `{checked_count, escalations_created}`; backend kiểm tra/ghi atomic |

Backend đánh giá rule và kiểm tra quyền/trạng thái; n8n chỉ điều phối. `/evaluate` không tin `priority`, `department_id`, `reporter_id` từ body. Nếu event đến hai lần, transaction/unique key trả cùng kết quả. Job SLA chỉ tạo escalation `(incident_id, level)` một lần và một outbox notification trong cùng transaction; deadline dựa `reported_at` đến `acknowledged_at` theo [phần A](phan-a-yeu-cau-nghiep-vu.md). Incident `triage_required` có hàng chờ/cảnh báo review riêng, không tự nhận P3.

**Giới hạn email:** nếu nhà cung cấp email đã nhận thư nhưng n8n chết trước khi ghi `sent`, hệ thống không thể chứng minh thư đã tới hộp nhận. Đánh dấu `uncertain` và yêu cầu người có quyền kiểm tra thủ công trước khi gửi lại; không hứa “exactly once” ở phía email. `claim` ngăn các lần gửi lặp trong điều kiện bình thường. Email chỉ dùng hộp thư thử, không có file, ghi chú nội bộ, token hay dữ liệu nhạy cảm.

## 7. Ví dụ luồng và ca lỗi bắt buộc

1. Reporter `POST /auth/login` → lấy bearer token; `POST /incidents` kèm `Idempotency-Key` → nhận 201, `status=reported` và ID. UI có thể upload file riêng, hiển thị lỗi từng file.
2. DB commit incident + outbox. Dispatcher gửi event đã ký; n8n gọi `/internal/events/{id}/evaluate`. Backend lưu rule/version/assignment/history atomically, trả kết quả cũ nếu event lặp. n8n claim/send/record email rồi complete event.
3. Handler được giao `POST /incidents/{id}/acknowledge` với `expected_version`; backend ghi `acknowledged_at` và dừng SLA tiếp nhận. Handler gửi resolution; manager đóng hoặc mở lại có lý do.
4. n8n tắt ở bước 2: `POST /incidents` vẫn thành công, outbox giữ pending và UI nói đang chờ tự động hóa. Khi n8n hoạt động lại, dispatcher retry có giới hạn.
5. Hai người thao tác cùng version: một giao dịch thắng, giao dịch còn lại 409; UI tải lại chi tiết và yêu cầu người dùng quyết định tiếp.
6. Reporter đổi UUID incident/file của người khác: 404 không lộ nội dung; manager khác bộ phận cũng 404. User có thể xem incident nhưng không được đóng nhận 403.

Các ca nghiệm thu chi tiết T01–T18 nằm trong [kế hoạch kiểm thử](test-plan.md). Trước khi coi contract đã được triển khai, test phải đối chiếu request/response thực với bảng này và OpenAPI của FastAPI, đặc biệt payload lỗi, idempotency, quyền bản ghi và giao dịch DB/outbox.
