# N5 — Event contract và webhook

`backend/app/automation` chứa event schema, chữ ký HMAC và `EventPublisher`.
JSON mẫu nằm ở `workflows/events`. N2, N3 và N4 phát event qua
`EventPublisher`; N5 xử lý phần gửi event sang n8n.

## Event envelope

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

## Chữ ký webhook

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

## Phát event

Ví dụ khi N2 tạo incident:

```python
from app.automation import EventType, get_event_publisher

publisher = get_event_publisher()
publisher.create_and_publish(
    event_type=EventType.INCIDENT_REPORTED,
    incident_id=incident.id,
    request_id=request_id,
)
```

N4 dùng `EventType.INCIDENT_ASSIGNED`; N3 dùng `EventType.SLA_ESCALATED`.
`InMemoryEventPublisher` chỉ phục vụ test/mock. Khi có outbox, event phải được
ghi trong cùng DB transaction với thay đổi incident; gọi hàm trên một mình
không bảo đảm tính atomic.

## Fixture và test

Các JSON trong `workflows/events/` dùng cho test và mock n8n:

1. [incident_reported.json](../workflows/events/incident_reported.json)
2. [incident_assigned.json](../workflows/events/incident_assigned.json)
3. [incident_priority_changed.json](../workflows/events/incident_priority_changed.json)
4. [sla_escalated.json](../workflows/events/sla_escalated.json)
5. [samples_invalid.json](../workflows/events/samples_invalid.json): payload thiếu/sai field hoặc chứa dữ liệu không được phép.
6. [samples_duplicate.json](../workflows/events/samples_duplicate.json): event gửi lặp và event ID trùng nhưng body khác.

Test ở [test_automation_events.py](../backend/tests/test_automation_events.py).
