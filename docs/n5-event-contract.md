# N5 — Event contract, outbox và webhook

`backend/app/automation` chứa event schema, chữ ký HMAC, `EventPublisher`, mô hình bảng Outbox/Notification, repository và worker stub.
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

## 4. Cơ chế Claim Lease, Retry và Backoff (W2)

Worker (`OutboxWorkerStub`) thực hiện chu kỳ xử lý:
1. **Claim lease**: Lấy các bản ghi `status == 'pending'` (đến hạn `next_attempt_at`) hoặc `status == 'processing'` nhưng `lease_expires_at <= now` (worker trước bị crash hoặc quá hạn lease). Sử dụng `SELECT ... FOR UPDATE SKIP LOCKED` trên PostgreSQL.
2. **Gán lease**: Cập nhật `status = 'processing'`, `lease_token = <worker_id>`, `lease_expires_at = now + lease_duration`, tăng `attempt_count`.
3. **Dispatch**: Chuyển payload sang webhook n8n kèm chữ ký HMAC.
4. **Complete hoặc Retry**:
   - Thành công: Đánh dấu `status = 'done'`, xóa lease.
   - Thất bại: Nếu `attempt_count < max_attempts`, chuyển về `pending` với exponential backoff (`next_attempt_at = now + base * 2^(attempt-1)`). Khi vượt quá số lần thử, chuyển thành `failed` (dead-letter).
   - Admin retry: Endpoint `/admin/events/{id}/retry` cho phép phục hồi bản ghi `failed` về `pending` kèm lý do.

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
