# N5 — Hợp đồng Sự kiện (Event Envelope), Chữ ký Webhook và Cổng phát Event (Tuần 1)

**Vị trí:** N5 — n8n, outbox & thông báo  
**Thời gian:** W1 (12/10/2026 – 18/10/2026)  
**Mục tiêu hoàn thành:** Định nghĩa event envelope, signature và fixture `incident.reported/assigned/priority/escalation` từ contract. Cung cấp mẫu hợp lệ/sai/trùng và cổng phát event ổn định cho backend khác (`N2, N3, N4`).

---

## 1. Ranh giới trách nhiệm của N5

- **Thư mục sở hữu:**
  - `backend/app/automation`: Chứa schemas event, logic chữ ký HMAC, cổng phát event (`EventPublisher`), outbox worker (từ W2), client webhook n8n.
  - `workflows`: Chứa kịch bản n8n JSON (`health-check.json`, các workflow tự động hóa, webhook triggers).
  - `workflows/events`: Chứa các fixture JSON sự kiện độc lập.
- **Ranh giới:** N5 **không** sửa code nghiệp vụ của N1 (auth/users), N2 (incidents/evidence), N3 (rules/SLA), N4 (assignments/workflow). Các mảng khác phát event thông qua cổng `EventPublisher` do N5 cung cấp.

---

## 2. Cấu trúc Event Envelope chuẩn

Tuân thủ nghiêm ngặt **Mục 6 của `docs/api-contract.md`**:

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

### Chi tiết các trường:

| Trường | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `event_id` | UUID chuỗi | Mã định danh duy nhất của sự kiện, đóng vai trò khóa Idempotency cho n8n |
| `event_type` | String Enum | Loại sự kiện: `incident.reported`, `incident.assigned`, `incident.priority_changed`, `sla.escalated` |
| `incident_id` | UUID chuỗi | Mã sự cố liên quan |
| `occurred_at` | ISO 8601 UTC | Thời điểm sự kiện phát sinh (định dạng `YYYY-MM-DDTHH:MM:SSZ`) |
| `schema_version` | Integer | Phiên bản hợp đồng sự kiện (mặc định là `1`) |
| `request_id` | UUID chuỗi | Khóa correlation tương ứng `X-Request-ID` để truy vết luồng xử lý |

> **Quy tắc bảo mật quan trọng:** Payload sự kiện **tuyệt đối không chứa** nội dung mô tả, file đính kèm, ghi chú nội bộ, mật khẩu hoặc dữ liệu nhạy cảm. Workflow n8n khi cần thông tin sẽ dùng Service Credential gọi ngược API nội bộ `/internal/*`. Schema được cấu hình `extra = "forbid"` để từ chối mọi trường lạ.

---

## 3. Bảo mật Webhook và Chữ ký HMAC-SHA256

Backend Dispatcher khi gửi sự kiện sang n8n Webhook (qua mạng nội bộ Docker) sẽ đính kèm 3 HTTP headers bắt buộc:

```http
X-CIM-Event-ID: d69996e8-ae76-44d4-a396-41694498feb3
X-CIM-Timestamp: 1730539800
X-CIM-Signature: sha256=a1b2c3d4e5f6... (hex HMAC-SHA256)
Content-Type: application/json
```

### 3.1. Thuật toán ký
1. Chuỗi cần ký: `<timestamp>.<raw_request_body>` (trong đó `timestamp` là Unix epoch tính bằng giây dạng số nguyên).
2. Mã hóa HMAC-SHA256 với secret dùng chung ngoài Git (`WEBHOOK_HMAC_SECRET`).
3. Giá trị header có tiền tố `sha256=`.

### 3.2. Cơ chế xác thực & Chống tấn công Replay
- Hàm `verify_webhook_request()` kiểm tra chữ ký bằng so sánh thời gian không đổi (`hmac.compare_digest`) để chống timing attack.
- Kiểm tra độ lệch thời gian: n8n từ chối mọi sự kiện có timestamp lệch quá **300 giây (5 phút)** so với giờ hệ thống hiện tại (`expired_timestamp` hoặc `future_timestamp`).
- `event_id` được lưu làm khóa Idempotency để chống xử lý lặp khi mạng retry.

---

## 4. Hướng dẫn sử dụng Cổng phát Event cho các mảng khác (N2, N3, N4)

N5 đã cung cấp interface chuẩn tại `app.automation.publisher`. Khi các thành viên khác cần phát sự kiện, chỉ cần gọi như sau:

### 4.1. Ví dụ cho N2 (Khi tạo Incident thành công trong transaction)
```python
from app.automation import EventType, get_event_publisher

# Trong transaction tạo incident của N2:
publisher = get_event_publisher()
event = publisher.create_and_publish(
    event_type=EventType.INCIDENT_REPORTED,
    incident_id=incident.id,
    request_id=request_id,
)
# event.event_id được cam kết cùng transaction outbox
```

### 4.2. Ví dụ cho N4 (Khi phân công sự cố thành công)
```python
from app.automation import EventType, get_event_publisher

publisher = get_event_publisher()
publisher.create_and_publish(
    event_type=EventType.INCIDENT_ASSIGNED,
    incident_id=incident.id,
    request_id=request_id,
)
```

### 4.3. Ví dụ cho N3 (Khi phát hiện quá hạn SLA trong Job kiểm tra)
```python
from app.automation import EventType, get_event_publisher

publisher = get_event_publisher()
publisher.create_and_publish(
    event_type=EventType.SLA_ESCALATED,
    incident_id=incident.id,
    request_id=request_id,
)
```

---

## 5. Danh mục Fixtures có sẵn

Các file JSON mẫu đặt tại thư mục `workflows/events/` để n8n và các bài test độc lập nạp trực tiếp:

1. [workflows/events/incident_reported.json](file:///c:/Users/Administrator/Desktop/Campus-Incident-Management/workflows/events/incident_reported.json): Mẫu sự kiện báo cáo sự cố hợp lệ.
2. [workflows/events/incident_assigned.json](file:///c:/Users/Administrator/Desktop/Campus-Incident-Management/workflows/events/incident_assigned.json): Mẫu sự kiện đã phân công cán bộ hợp lệ.
3. [workflows/events/incident_priority_changed.json](file:///c:/Users/Administrator/Desktop/Campus-Incident-Management/workflows/events/incident_priority_changed.json): Mẫu sự kiện điều chỉnh độ ưu tiên hợp lệ.
4. [workflows/events/sla_escalated.json](file:///c:/Users/Administrator/Desktop/Campus-Incident-Management/workflows/events/sla_escalated.json): Mẫu sự kiện cảnh báo leo thang SLA hợp lệ.
5. [workflows/events/samples_invalid.json](file:///c:/Users/Administrator/Desktop/Campus-Incident-Management/workflows/events/samples_invalid.json): 3 kịch bản lỗi (thiếu incident ID, sai event type, chứa trường nhạy cảm bị cấm).
6. [workflows/events/samples_duplicate.json](file:///c:/Users/Administrator/Desktop/Campus-Incident-Management/workflows/events/samples_duplicate.json): Cặp sự kiện thử nghiệm Idempotency (gửi lại giống hệt vs xung đột nội dung).

Bộ kiểm thử hoàn chỉnh tại [backend/tests/test_automation_events.py](file:///c:/Users/Administrator/Desktop/Campus-Incident-Management/backend/tests/test_automation_events.py) bảo đảm độ tin cậy và sự sẵn sàng cho W2 (Migration outbox & Webhook n8n).
