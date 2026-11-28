# N5 — Event contract, outbox và webhook

`backend/app/automation` chứa event schema, chữ ký HMAC, `EventPublisher`, mô hình bảng Outbox/Notification, repository, dispatcher webhook và worker outbox.
JSON mẫu nằm ở `workflows/events`. N2, N3 và N4 phát event qua
`EventPublisher`; N5 xử lý phần lưu trữ outbox, claim lease, retry và gửi event sang n8n.

## 1. Event envelope

Payload theo [API contract](api-contract.md):

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

`event_id` là khóa idempotency; `request_id` dùng để truy vết cùng request.
`event_type` nhận `incident.reported`, `incident.assigned`,
`incident.priority_changed` hoặc `sla.escalated`. Payload không chứa mô tả,
file, comment nội bộ hay secret. n8n lấy metadata cần thiết qua `/internal/*`.

## 2. Chữ ký webhook

Dispatcher gửi event với ba header:

```http
X-CIM-Event-ID: d69996e8-ae76-44d4-a396-41694498feb3
X-CIM-Timestamp: 1793611800
X-CIM-Signature: sha256=<HMAC-SHA256 hex>
Content-Type: application/json
```

Ký chuỗi `<timestamp>.<raw_request_body>` bằng HMAC-SHA256 với
`WEBHOOK_HMAC_SECRET` nằm ngoài Git. `verify_webhook_request()` so sánh chữ ký
bằng `hmac.compare_digest`, từ chối timestamp lệch quá 300 giây. Bên nhận dùng
`event_id` để bỏ qua event lặp.

## 3. Lưu trữ Outbox và Transactional Publisher (W2)

Để đảm bảo tính atomic giữa lưu dữ liệu sự cố và sự kiện gửi sang n8n:
- N2 (tạo incident), N3 (SLA escalation), N4 (assignment) sử dụng `OutboxEventPublisher(session)` trong cùng database transaction.
- Bảng `outbox_events` lưu sự kiện với trạng thái `pending`. Nếu n8n gặp sự cố, sự kiện vẫn được giữ an toàn trong database.

```python
from app.automation import OutboxEventPublisher, EventType

# Trong cùng transaction commit incident:
publisher = OutboxEventPublisher(session)
publisher.create_and_publish(
    event_type=EventType.INCIDENT_REPORTED,
    incident_id=incident.id,
    request_id=request_id,
)
session.commit()
```

## 4. Cơ chế Claim Lease, Retry và Backoff (W2) và Dispatcher thật (W4)

Worker (`OutboxWorkerStub`, tên giữ để tương thích import) thực hiện chu kỳ xử lý:
1. **Claim lease**: Lấy các bản ghi `status == 'pending'` (đến hạn `next_attempt_at`) hoặc `status == 'processing'` nhưng `lease_expires_at <= now` (worker trước bị crash hoặc quá hạn lease). Sử dụng `SELECT ... FOR UPDATE SKIP LOCKED` trên PostgreSQL.
2. **Gán lease**: Cập nhật `status = 'processing'`, `lease_token = <worker_id>`, `lease_expires_at = now + lease_duration`, tăng `attempt_count`.
3. **Dispatch**: `WebhookDispatcher` POST envelope đã ký HMAC sang webhook n8n. Mỗi event có transaction riêng nên một event lỗi không kéo theo event khác.
4. **Complete hoặc Retry**:
   - `2xx`: n8n đã nhận event. Worker đánh dấu `status = 'done'`, xóa lease. Nếu n8n đã gọi `/internal/events/{id}/complete` trước đó thì worker nhận biết và không tính trùng.
   - `408`, `425`, `429`, `5xx`, lỗi mạng/timeout: retryable. Nếu `attempt_count < max_attempts`, chuyển về `pending` với exponential backoff (`next_attempt_at = now + base * 2^(attempt-1)`), chặn trần bằng `max_backoff_seconds`. Khi vượt quá số lần thử, chuyển thành `failed` (dead-letter).
   - `4xx` còn lại (ví dụ `400`, `422`): lỗi vĩnh viễn, chuyển thẳng `failed` để không đốt hết số lần thử.
   - Admin retry: `retry_dead_letter(event_id, reason)` đưa bản ghi `failed` về `pending`, giữ lý do trong `error_message`.
5. **Phục hồi sau restart**: `recover_interrupted_events()` đưa các event `processing` có lease đã hết hạn về `pending` với `next_attempt_at = now`. Event đang có lease còn hiệu lực không bị lấy lại, nên hai worker chạy song song không dispatch trùng.
6. **Vòng lặp**: `run_forever()` bắt lỗi từng chu kỳ và tiếp tục poll; `SIGINT`/`SIGTERM` dừng sau chu kỳ hiện tại.

Thông điệp lỗi được rút gọn còn 1000 ký tự và che secret cấu hình trước khi ghi `error_message`; URL có credential bị thay bằng `scheme://host/***`.

Bảo đảm giao nhận là **at-least-once**: n8n và backend phải idempotent theo `event_id`. HTTP 2xx chỉ nghĩa là n8n đã nhận event.

### Cấu hình dispatcher

Bí mật và URL nằm ngoài Git:

| Biến | Ý nghĩa | Mặc định local |
| --- | --- | --- |
| `CIM_OUTBOX_WEBHOOK_URL` hoặc `N8N_WEBHOOK_URL` | URL webhook n8n | `http://localhost:5678/webhook/events` |
| `CIM_WEBHOOK_HMAC_SECRET` | Secret ký HMAC | placeholder dev (không dùng ngoài local) |
| `CIM_OUTBOX_POLL_INTERVAL_SECONDS` | Chu kỳ poll | `5` |
| `CIM_OUTBOX_BATCH_SIZE` | Số event mỗi lượt claim | `10` |
| `CIM_OUTBOX_LEASE_SECONDS` | Thời hạn lease | `60` |
| `CIM_OUTBOX_BACKOFF_BASE_SECONDS` | Cơ sở backoff | `5` |
| `CIM_OUTBOX_BACKOFF_MAX_SECONDS` | Trần backoff | `300` |
| `CIM_OUTBOX_WEBHOOK_TIMEOUT_SECONDS` | Timeout HTTP | `10` |
| `CIM_OUTBOX_WORKER_ID` | ID worker (mặc định sinh ngẫu nhiên) | — |
| `CIM_OUTBOX_DISPATCH_ENABLED` | Bật/tắt dispatcher | `true` |

Các biến trên đọc trực tiếp từ môi trường hoặc file `.env` (đã bị Git bỏ qua). Không commit secret thật; thêm biến vào `.env` local của bạn. Khi dispatcher chạy trong Compose, đặt `N8N_WEBHOOK_URL=http://n8n:5678/webhook/events`.

### Chạy dispatcher

Từ `backend/` (sau khi migration đã chạy):

```powershell
# Xử lý một lượt rồi thoát (phù hợp test/CI)
.venv/Scripts/python.exe -m app.automation.run_worker --once

# Đưa event có lease hết hạn về pending, rồi thoát
.venv/Scripts/python.exe -m app.automation.run_worker --recover

# Chạy liên tục đến khi Ctrl+C/SIGTERM
.venv/Scripts/python.exe -m app.automation.run_worker
```

Trong Compose, dùng cùng image backend:

```powershell
docker compose run --rm -e N8N_WEBHOOK_URL=http://n8n:5678/webhook/events backend python -m app.automation.run_worker
```

Worker khởi động lại (restart, deploy, crash) không mất event vì trạng thái nằm trong PostgreSQL; chỉ các lease đã hết hạn được thu hồi, còn lại chờ hết hạn tự nhiên. `run_forever()` gọi `recover_interrupted_events()` ngay khi khởi động (tắt bằng `requeue_on_start=False` nếu cần kiểm soát thủ công).

Nếu chưa từng chạy migration hoặc PostgreSQL chưa lên, CLI trả mã thoát `1` và log lỗi kết nối thay vì crash im lặng.

## 5. Idempotency Khóa Thông Báo (`notifications`) (W2)

Bảng `notifications` bảo vệ chống gửi email trùng lặp:
- Khóa duy nhất: `(event_id, kind, recipient_user_id)`.
- Hàm `claim_notification` trả về `(notification, should_send)`:
  - Nếu bản ghi chưa tồn tại: tạo mới với `status='pending'` và `should_send=True`.
  - Nếu đã có bản ghi: trả về bản ghi hiện tại và `should_send=False`.
- Hàm `complete_notification` ghi nhận kết quả: `sent`, `failed` hoặc `uncertain`. Các bản ghi `sent` và `uncertain` không được tự động gửi lại.

## 6. Workflow n8n giả lập (`mock-event-receiver.json`) (W2)

Nằm tại `workflows/mock-event-receiver.json`, tiếp nhận webhook POST, kiểm tra envelope, và trả về HTTP 200 xác nhận kèm `run_id` giả lập.

## 7. Service Bearer Authentication `/internal/*` (W3)

Để n8n gọi ngược lại backend thực hiện các thao tác xử lý nghiệp vụ (`/internal/*`) mà không dùng token người dùng:
- n8n sử dụng **Service Bearer Token** riêng biệt (`Authorization: Bearer <service_token>`).
- Cấu hình bí mật ngoài Git: `CIM_INTERNAL_SERVICE_BEARER_TOKENS` (danh sách token) hoặc `CIM_INTERNAL_SERVICE_TOKEN_HASHES` (danh sách hash SHA-256).
- **Lưu hash token và hỗ trợ xoay vòng (rotation):** Backend không lưu token thô trong bộ nhớ/DB mà chỉ lưu hash SHA-256, so sánh hằng định thời gian (`hmac.compare_digest`). Trong quá trình xoay vòng token, nhiều token hash có thể cùng active để không làm gián đoạn request đang xử lý.
- **Từ chối User Token:** Token người dùng (session của reporter, handler, manager, admin) tuyệt đối không được phép gọi các endpoint `/internal/*`. Khi phát hiện token người dùng, hệ thống từ chối với HTTP 403 Forbidden (`User tokens are not permitted to access internal endpoints`).
- **Danh sách endpoint `/internal/*`:**
  - `GET /internal/events/{event_id}`: Metadata tối thiểu cho event, không lộ mô tả/file/secret.
  - `POST /internal/events/{event_id}/evaluate`: Đánh giá sự cố theo rule, idempotent.
  - `POST /internal/events/{event_id}/complete`: Đánh dấu `done` hoặc `failed`, chặn chuyển trạng thái sai `done → failed`.
  - `POST /internal/notifications/claim`: Đăng ký claim gửi thông báo với khóa duy nhất `(event_id, kind, recipient_user_id)`.
  - `POST /internal/notifications/{id}/complete`: Ghi nhận trạng thái gửi `sent`, `failed` hoặc `uncertain`.
  - `POST /internal/sla/check`: Kiểm tra SLA định kỳ cho job n8n.
  - `POST /internal/webhooks/verify`: Endpoint xác thực webhook inbound bằng chữ ký HMAC và timestamp.

## 8. HMAC Timestamp & Event ID ngoài Git (W3)

- Bí mật HMAC được nạp từ biến môi trường ngoài Git (`CIM_WEBHOOK_HMAC_SECRET` hoặc `WEBHOOK_HMAC_SECRET`).
- Hỗ trợ xoay vòng bí mật (`CIM_WEBHOOK_HMAC_SECRETS_ROTATION`).
- `verify_webhook_request()` và dependency `require_valid_webhook_signature`:
  - Từ chối chữ ký sai (`invalid_signature` -> 401).
  - Từ chối timestamp quá hạn lệch quá 300 giây về quá khứ (`expired_timestamp` -> 401) hoặc tương lai (`future_timestamp` -> 401).
  - Kiểm tra định dạng UUID của `X-CIM-Event-ID` (`invalid_event_id` -> 422).
  - Kiểm tra đầy đủ header bắt buộc (`missing_headers` -> 400).

## 9. Fixture và kiểm thử

- Fixture JSON: `workflows/events/`
- Test hợp đồng và signature W1: `backend/tests/test_automation_events.py`
- Test outbox claim, retry và notification W2: `backend/tests/test_outbox_repository.py`
- Test service bearer auth, user token rejection, rotation và HMAC W3: `backend/tests/test_automation_service_bearer.py`
- Test dispatcher ký HMAC, backoff, dead-letter, n8n down và phục hồi sau restart W4: `backend/tests/test_automation_dispatcher.py`
- Test workflow W5 (chữ ký giả, timestamp quá hạn/tương lai, event trùng, run ID): `backend/tests/test_automation_workflow.py`

## 10. Workflow webhook xử lý event (W5)

`workflows/event-processor.json` là workflow n8n thật thay cho mock receiver W2:

1. `Webhook Receiver` nhận `POST` tại path `events` và bật **Raw Body** để giữ nguyên
   bytes phục vụ kiểm chữ ký.
2. `Verify Signature` gọi `POST /internal/webhooks/verify` với raw body và ba header
   `X-CIM-*`, dùng Header Auth credential `CIM Internal Service Bearer`.
3. `Signature Valid?` chỉ cho đi tiếp khi response có `status="verified"`. Chữ ký sai,
   body bị sửa, timestamp quá hạn/tương lai hoặc event ID sai bị trả `401`/`422`
   tại `Respond Rejected`; outbox không bị thay đổi và không gọi evaluate.
4. `Duplicate Check` gọi `GET /internal/events/{event_id}`. Nếu event đã `done`,
   `Respond Duplicate` trả `200` với `duplicate=true` và bỏ qua evaluate lần hai.
5. `Evaluate Incident` gọi `POST /internal/events/{event_id}/evaluate` với
   `run_id = $execution.id`. Backend không tin `priority`, `department_id` hay
   `reporter_id` từ body; kết quả evaluate là idempotent theo `event_id`.
6. `Complete Event (Done)` hoặc `Complete Event (Failed)` gọi
   `POST /internal/events/{event_id}/complete` để đóng vòng đời event.
7. Mọi response đều có `run_id` (lấy từ execution ID của n8n); response xử lý thành
   công còn có `event_id`, `duplicate` và object `evaluation`.

### Cấu hình workflow

| Thành phần | Giá trị |
| --- | --- |
| Backend URL trong n8n | `http://backend:8000` (hardcode trong 5 node HTTP; sửa nếu n8n chạy ngoài Compose) |
| Credential gọi `/internal/*` | Header Auth tên `CIM Internal Service Bearer`, header `Authorization`, giá trị `Bearer <service token>` |
| Webhook secret | `CIM_WEBHOOK_HMAC_SECRET` (hoặc rotation) ngoài Git, dùng chung với dispatcher |
| Webhook path | `events` (`http://localhost:5678/webhook/events` khi chạy Compose) |

Workflow không nhúng token hay HMAC secret vào JSON; chỉ chứa tham chiếu credential và
expression `$execution.id`. Khi import, tạo credential trước, sau đó publish workflow.
Nếu vẫn giữ `mock-event-receiver.json` ở cùng path `events`, phải tắt một trong hai
workflow để tránh trùng webhook.

### Hành vi theo tiêu chí W5

| Ca | Kết quả |
| --- | --- |
| Event hợp lệ | `200 processed`, có `run_id`, event chuyển `done` |
| Event giả / body bị sửa | `401 rejected`, outbox vẫn `pending`, không evaluate |
| Timestamp quá hạn hoặc ở tương lai | `401 rejected`, không evaluate |
| Event trùng đã `done` | `200 duplicate`, không evaluate lại, vẫn có `run_id` |
| Evaluate lỗi | gọi complete `failed`, trả `502` kèm `run_id` để truy vết |

Gửi thử một event đã ký từ máy local:

```powershell
backend\.venv\Scripts\python.exe scripts\send-signed-event.py `
  --url http://localhost:5678/webhook/events `
  --secret $env:CIM_WEBHOOK_HMAC_SECRET
```

Thêm `--timestamp-offset -301` để kiểm tra nhánh từ chối event quá hạn. Chạy lại cùng
`--event-id` sau khi event đã `done` để kiểm tra nhánh duplicate.

## 11. Notification Claim, Idempotency và Email thử nghiệm (W6)

Nhằm bảo vệ hệ thống không gửi email trùng lặp và tuân thủ chặt chẽ quyền riêng tư dữ liệu:

### Idempotency Key của Notification
- Khóa duy nhất: `(event_id, kind, recipient_user_id)`.
- `POST /internal/notifications/claim`:
  - Lần claim đầu tiên: tạo bản ghi `notifications` với `status='pending'` và trả `should_send=true`.
  - Lần claim tiếp theo (do n8n replay hoặc retry): trả bản ghi hiện tại và `should_send=false`. Email sender sẽ **không được kích hoạt** lần hai.

### 3 kịch bản Email thử nghiệm MVP
1. **Báo cáo sự cố (`incident_reported`)**:
   - Gửi đến: Người báo sự cố (`reporter_user_id`, email: `reporter@demo.invalid`).
   - Tiêu đề: `[CIM] Tiếp nhận báo cáo sự cố #{short_id}`.
   - Nội dung: Xác nhận mã sự cố, danh mục, thời gian báo cáo và đường dẫn theo dõi tiến độ:
     `http://localhost:5173/incidents/{incident_id}`.
2. **Phân công kỹ thuật viên (`incident_assigned`)**:
   - Gửi đến: Nhân viên kỹ thuật phụ trách (`handler_user_id`, email: `handler@demo.invalid`).
   - Tiêu đề: `[CIM] Phân công xử lý sự cố #{short_id}`.
   - Nội dung: Thông tin bộ phận, mức ưu tiên và đường dẫn thao tác tiếp nhận (Acknowledge) trong portal staff:
     `http://localhost:5173/staff/incidents/{incident_id}`.
3. **Cảnh báo khẩn cấp P1 (`p1_alert`)**:
   - Gửi đến: Quản lý bộ phận trực ban / điều hành (`manager_user_id`, email: `manager@demo.invalid`).
   - Tiêu đề: `[CIM KHẨN CẤP] Cảnh báo sự cố mức độ P1 #{short_id}`.
   - Nội dung: Cảnh báo mức ưu tiên P1, lý do đánh giá khẩn cấp, hạn SLA tiếp nhận và đường dẫn trực ban:
     `http://localhost:5173/staff/incidents/{incident_id}`.

### Chính sách an toàn nội dung (Content Security Guard)
Hàm `validate_notification_safety()` kiểm tra và chặn mọi email nếu phát hiện:
- **File đính kèm hoặc raw binary**: Không đính kèm tệp, không chứa base64 payload, không chứa URL download có token.
- **Mật khẩu & Bí mật**: Tuyệt đối không gửi `password`, `password_hash`, token phiên (`Bearer`, `access_token`), HMAC secret hay API key.
- **Ghi chú nội bộ**: Tuyệt đối không đưa ghi chú nội bộ của nhân viên (`[internal]`, `internal_note`, `visibility: internal`) vào email gửi cho người dùng.

## 12. Dead-letter Queue, Admin Retry và Trạng thái Sent/Failed/Uncertain (W7)

Nhằm đảm bảo mọi lỗi giữa chừng đều truy vết được và ngăn ngừa sự cố gửi lặp thư:

### Phân loại trạng thái gửi Notification
- `pending`: Đã claim tác vụ, đang chờ gửi.
- `sent`: Đã nhận xác nhận gửi thành công từ mail server, lưu kèm `provider_message_id`.
- `failed`: Mail server từ chối vĩnh viễn (lỗi 5xx hoặc địa chỉ người nhận không hợp lệ).
- `uncertain`: Mạng bị đứt gãy hoặc timeout giữa chừng khi đang gửi thư (không rõ mail server đã phát thư tới hộp thư người nhận hay chưa).

> [!IMPORTANT]
> **Quy tắc bất biến (Critical Invariant): `uncertain` không bao giờ được tự động gửi lại.**
> Khi một notification ở trạng thái `sent` hoặc `uncertain`, hàm `claim_notification` luôn trả về `should_send=false`. Không có worker hay job tự động nào được phép tự ý gửi lại. Chỉ người quản trị hệ thống (Administrator) sau khi xác minh thủ công mới được quyền re-queue có lý do kiểm toán.

### Dead-letter Queue (DLQ) cho Outbox Event
Một event outbox được chuyển thành `failed` (dead-letter) khi:
1. Đã thử đủ số lần `max_attempts` (mặc định 5 lần) với exponential backoff bị chặn trần (`max_backoff_seconds=300`).
2. Gặp lỗi 4xx không thể khắc phục (như 400 Bad Request, 422 Unprocessable Content), được đưa thẳng vào dead-letter để tránh lãng phí lần thử.

Thông điệp lỗi được cắt gọt còn tối đa 1000 ký tự và che giấu toàn bộ secret (`***`) trước khi lưu trữ hoặc xuất qua API.

### Thao tác quản trị Admin Retry (bắt buộc có lý do)
Admin có thể kiểm tra danh sách và gửi lại thủ công qua API hoặc CLI:

#### Qua API nội bộ:
- `GET /internal/events/failed`: Liệt kê các event trong hàng đợi dead-letter với phân trang cursor.
- `POST /internal/events/{event_id}/retry`: Re-queue event thất bại về trạng thái `pending`, reset `attempt_count=0`. Yêu cầu body `{ "reason": "Lý do thao tác" }`. Endpoint có tính idempotent nếu event đã `pending` hoặc `done`.
- `GET /internal/notifications?status=uncertain`: Liệt kê các thông báo đang ở trạng thái nghi ngờ.
- `POST /internal/notifications/{id}/retry`: Re-queue thông báo `failed` hoặc `uncertain` về `pending` kèm lý do.
- `GET /internal/dead-letter/summary`: Thống kê tổng số lượng event lỗi, notification lỗi và notification uncertain.

#### Qua CLI:
```powershell
# Xem danh sách event chết
backend\.venv\Scripts\python.exe -m app.automation.run_worker --list-failed

# Re-queue event outbox bị chết (bắt buộc --reason)
backend\.venv\Scripts\python.exe -m app.automation.run_worker --retry-event <event_id> --reason "Khôi phục kết nối mạng tới n8n"

# Xem danh sách thông báo uncertain
backend\.venv\Scripts\python.exe -m app.automation.run_worker --list-notifications --status uncertain

# Re-queue thông báo uncertain (bắt buộc --reason)
backend\.venv\Scripts\python.exe -m app.automation.run_worker --retry-notification <notification_id> --reason "Đã xác minh hộp thư đích chưa nhận được thư"
```

### Kiểm thử W6 & W7
Bộ kiểm thử chấp nhận toàn diện cho W6 và W7 được triển khai tại:
`backend/tests/test_automation_notifications.py` (34 test cases bao phủ kịch bản gửi đúng người/link, chặn file/secret/ghi chú nội bộ, dead-letter, lý do admin retry, và bất biến uncertain).

## 13. Ghép Event Thật Từ N2/N3/N4, Workflow Evaluate và Schedule SLA Check (W8)

Nhằm hoàn thiện luồng tích hợp tự động hóa cho mốc W8:

### 1. Ghép Event Thật từ N2/N3/N4
Các sự kiện nghiệp vụ thực tế được liên kết đồng bộ qua bảng transactional outbox:
- **N2 (`incident.reported`)**: Khi người báo gửi sự cố mới qua API `/api/v1/incidents`, bản ghi sự cố và event `incident.reported` được commit atomic trong cùng transaction.
- **N4 (`incident.assigned` & `incident.priority_changed`)**: Khi cán bộ phân công kỹ thuật viên hoặc điều chỉnh priority, sự kiện được ghi nhận vào outbox để kích hoạt thông báo n8n.
- **N3 (`sla.escalated`)**: Khi tác vụ rà soát SLA phát hiện sự cố quá hạn chưa được tiếp nhận, bản ghi leo thang (escalation) và event `sla.escalated` được lưu atomic vào outbox.

### 2. Ba ca MVP Đi Xuyên Backend → n8n → Backend
Luồng khép kín hoàn chỉnh giữa backend và n8n:
1. **Rò nước (`water_leak`)**: Dữ liệu khảo sát (ví dụ: nước gần điện `near_electricity="yes"`) đi qua n8n -> gọi `/internal/events/{id}/evaluate` -> bộ quy tắc Rule Engine N3 khớp quy tắc **R03**, gán priority **P1**, bộ phận **Cơ sở vật chất**, cập nhật incident trong DB -> n8n gọi `/internal/events/{id}/complete` chuyển event thành `done`.
2. **Nguy hiểm điện (`electrical_hazard`)**: Dấu hiệu khói/tia lửa (`smoke_or_sparks="yes"`) -> khớp quy tắc **R01**, priority **P1**, bộ phận **Điện và an toàn**, severity **critical**.
3. **Lừa đảo (`phishing`)**: Đã nhập thông tin (`interaction="entered_information"`) -> khớp quy tắc **R02**, priority **P1**, bộ phận **IT/Security**, severity **high**.

Tất cả các lệnh gọi `/evaluate` có tính idempotent cao: nếu gọi lại cùng một event, hệ thống trả về kết quả nhất quán mà không tính toán lại hay ghi đè sai lệch dữ liệu.

### 3. Workflow Schedule SLA Check và Bất Biến "Báo Một Lần/Mức"
- **Workflow n8n (`workflows/sla-check.json`)**:
  - `Schedule Trigger`: Định kỳ 1 phút (hoặc theo cấu hình cron) tự động kích hoạt.
  - Gọi `POST /internal/sla/check` với service bearer token để quét toàn bộ sự cố đang ở trạng thái `reported` hoặc `assigned` đã quá deadline tiếp nhận (`acknowledgment_deadline_at`).
- **Quy tắc bất biến: SLA báo một lần/mức**:
  - Mỗi sự cố chỉ được phép tạo đúng 1 bản ghi `escalations` cho mỗi cấp độ (`level=1`).
  - Lệnh gọi định kỳ lặp lại sẽ bỏ qua các sự cố đã được leo thang ở mức này (`escalations_created=0`), đảm bảo không spam cảnh báo hay lặp event vô hạn.
  - Bản ghi leo thang mới sẽ phát sinh event `sla.escalated` vào outbox để dispatcher chuyển tiếp sang n8n gửi email khẩn cấp cho Quản lý trực ban.
- **CLI hỗ trợ**:
  ```powershell
  # Chạy kiểm tra SLA ngay lập tức từ dòng lệnh
  backend\.venv\Scripts\python.exe -m app.automation.run_worker --check-sla
  ```

### 4. Kiểm Thử Chấp Nhận W8
Bộ kiểm thử chấp nhận tích hợp W8 tại `backend/tests/test_automation_w8_integration.py` bao phủ:
- Luồng 3 ca MVP đi xuyên backend -> n8n -> backend.
- Đầy đủ các domain event thực tế từ N3 và N4.
- Bất biến kiểm tra SLA báo một lần/mức và dispatch event `sla.escalated`.
- Kiểm thử workflow file JSON và cờ CLI `--check-sla`.

## 14. Email Cập Nhật Public State, Khóa Chống Trùng và Giới Hạn Nội Dung (W9)

Nhằm bảo đảm người báo sự cố luôn được thông báo minh bạch về tiến độ công khai mà không làm lộ dữ liệu nội bộ:

### 1. Kịch bản Thông báo Public State (`public_state_updated`)
- **Đối tượng nhận**: Người báo sự cố (`reporter_user_id`, email: `reporter@demo.invalid`).
- **Trạng thái công khai hợp lệ**: `assigned` (Đã phân công), `in_progress` (Đang xử lý), `resolved` (Đã khắc phục), `closed` (Đã đóng), `reopened` (Mở lại).
- **Tiêu đề**: `[CIM] Cập nhật tiến độ sự cố #{short_id}: {state_display}`.
- **Nội dung công khai**:
  - Mã sự cố, tên trạng thái công khai mới, thời gian cập nhật (UTC).
  - Kết quả xử lý công khai (`resolution_summary`) khi sự cố được giải quyết (`resolved`).
  - Đường dẫn theo dõi công khai: `http://localhost:5173/incidents/{incident_id}`.

### 2. Chính Sách Giới Hạn Nội Dung Nghiêm Ngặt (Content Safety Guards)
Hàm `validate_notification_safety()` và `build_public_state_notification()` chặn ngay lập tức nếu phát hiện:
- **Ghi chú nội bộ**: Tuyệt đối không cho phép `[internal]`, `internal_note`, `internal_comment`, `visibility: internal`, `handler_note`, `triage_reason`.
- **Đường dẫn quản trị staff**: Người báo tuyệt đối không nhận link portal nội bộ (`/staff/incidents/*`).
- **Mật khẩu & Bí mật**: Tuyệt đối cấm xuất hiện `password`, `Bearer token`, `access_token`, secret.
- **Tệp đính kèm & Binary**: Không cho phép đính kèm tệp hay base64 raw data trong email gửi người báo.

### 3. Khóa Chống Trùng & Chính Sách Retry
- **Khóa duy nhất (Idempotency Key)**: `(event_id, 'public_state_updated', recipient_user_id)`.
- **Cơ chế chống gửi lặp**:
  - Lần claim đầu tiên: ghi nhận bản ghi `pending` và trả `should_send=true` để phát thư.
  - Các lần claim tiếp theo do retry/replay từ n8n hoặc mạng: trả `should_send=false` và bỏ qua gửi (`was_newly_sent=false`).
- **Bất biến retry**:
  - Không có bất kỳ worker hay luồng tự động nào được tự ý gửi lại các email ở trạng thái `sent` hoặc `uncertain`.
  - Giúp loại bỏ hoàn toàn rủi ro người báo nhận hàng loạt thư trùng lặp khi hệ thống xảy ra timeout hoặc retry.

### 4. Kiểm Thử Chấp Nhận W9
Bộ kiểm thử chấp nhận W9 tại `backend/tests/test_automation_w9_integration.py` bao phủ toàn diện:
- Tạo và định dạng thông báo cho đầy đủ 5 trạng thái công khai.
- Từ chối trạng thái không hợp lệ hoặc trạng thái nội bộ.
- Bộ lọc Content Safety chặn ghi chú nội bộ, link staff và mật khẩu.
- Khóa chống trùng chặn gửi lặp khi retry qua repository và API `POST /internal/notifications/dispatch`.

## 15. Kiểm Thử Khả Năng Chống Chịu Lỗi & Độ Tin Cậy T13–T15 (W10)

Mốc W10 tập trung kiểm thử toàn diện các tình huống gián đoạn dịch vụ, duplicate delivery, lệch xung nhịp đồng hồ và phục hồi sau sự cố:

### 1. T13: Chống Nhân Đôi Nghiệp Vụ & Duplicate Webhook
- Khi event hoặc webhook bị phát lại nhiều lần do timeout hoặc retry mạng:
  - Lần 1: Thực hiện evaluate và ghi nhận trạng thái `done`.
  - Lần 2 trở đi: Nhánh duplicate của workflow n8n gọi `GET /internal/events/{id}` phát hiện trạng thái đã `done`, trả HTTP 200 `duplicate=true` và bỏ qua evaluate.
  - Phân công (`assignment`), lịch sử (`status_history`) và phiên bản (`incident.version`) không bị nhân đôi.
  - Notification dispatch được bảo vệ bằng khóa duy nhất `(event_id, kind, recipient_user_id)` nên không gửi email lặp.

### 2. T14: n8n Ngoại Tuyến Khi Tạo Báo Cáo
- Sự cố được lưu trữ an toàn trong PostgreSQL bất kể n8n đang chạy hay dừng hoạt động:
  - API tạo báo cáo commit atomic dữ liệu sự cố và bản ghi outbox với `status='pending'`.
  - Dispatcher gặp lỗi kết nối (`Connection refused` hoặc timeout) sẽ ghi nhận lỗi và áp dụng thuật toán exponential backoff có chặn trần (`max_backoff_seconds=300`).
  - Khi n8n được khởi động lại, chu kỳ quét outbox tiếp theo lập tức claim và gửi lại sự kiện thành công mà không thất thoát bất kỳ báo cáo nào.

### 3. T15: Lỗi Giao Nhận Email/API, Hàng Đợi Dead-Letter & Can Thiệp Quản Trị
- Các lỗi tạm thời (5xx, timeout mạng) chuyển về `pending` với backoff để thử lại.
- Các lỗi vĩnh viễn (4xx client error, payload sai cấu trúc) chuyển thẳng vào hàng đợi chết `failed` để tránh lãng phí lần thử.
- Trạng thái `uncertain` (timeout khi phát mail) tuân thủ quy tắc bất biến: không bao giờ tự động gửi lại.
- Quản trị viên (Admin) xem xét hàng đợi chết qua API/CLI và chỉ được quyền retry khi cung cấp lý do kiểm toán rõ ràng (`--reason`).

### 4. Khả Năng Dung Lỗi Lệch Đồng Hồ (Clock Skew Tolerance)
- Cửa sổ chấp nhận timestamp: dung sai tối đa **300 giây** cho cả quá khứ và tương lai.
- Chữ ký có timestamp lệch trong khoảng [-300s, +300s] được xác thực thành công.
- Chữ ký lệch quá 300s bị từ chối dứt khoát với mã lỗi 401 (`expired_timestamp` hoặc `future_timestamp`).

### 5. Phục Hồi Sau Khởi Động Lại (Crash Recovery)
- Worker gặp sự cố khi đang xử lý để lại các bản ghi ở trạng thái `processing`.
- Khi worker khởi động lại, hàm `recover_interrupted_events()` tự động quét các bản ghi có lease đã hết hạn và chuyển về `pending` để tiếp tục chu trình xử lý mà không làm gián đoạn hệ thống.

### 6. Bộ Kiểm Thử Chấp Nhận W10
Toàn bộ kịch bản kiểm thử T13–T15 được thực thi tự động tại:
`backend/tests/test_automation_w10_integration.py` (7/7 tests đạt 100%).
