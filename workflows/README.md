# Workflow n8n

## 1. Workflow kiểm tra kết nối (`health-check.json`)

`health-check.json` là workflow mẫu **inactive**: Manual Trigger → HTTP GET backend liveness. Không có credentials hoặc xử lý incident. Workflow đã được import và chạy thành công trên n8n Docker; HTTP node nhận `status=ok` từ backend. ID mẫu: `CIMHealthCheck001`. Workflow vẫn inactive và chỉ chạy thủ công.

### Import mẫu khi n8n đã chạy

1. Mở `http://localhost:5678`, tạo owner account lần đầu.
2. Tạo workflow và chọn import từ file `health-check.json`.
3. Với n8n trong Compose, URL backend là `http://backend:8000/api/v1/health/live`.
4. Nếu n8n ở ngoài Docker, sửa URL về backend tương ứng.
5. Chạy thủ công, kiểm tra response `status=ok`.

### Import và chạy bằng CLI

```powershell
docker compose cp workflows/health-check.json n8n:/tmp/cim-health-check.json
docker compose exec -T n8n n8n import:workflow --input=/tmp/cim-health-check.json
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n execute --id=CIMHealthCheck001
```

Cổng broker 5680 chỉ dùng cho process CLI để tránh xung đột broker của n8n server. Chạy lần hai sẽ dùng cùng ID mẫu. Không sử dụng ID này cho workflow nghiệp vụ khác.

Image n8n hiện báo thiếu Python task runner nội bộ. Hai node Manual Trigger/HTTP Request không cần Python nên workflow mẫu vẫn đạt. Nếu sau này cần Python Code node, thiết lập external task runner riêng; Python backend không thay thế runner của n8n.

---

## 2. Workflow giả lập nhận event (`mock-event-receiver.json` — N5 W2)

`mock-event-receiver.json` là workflow giả lập (mock receiver) cho mảng N5 W2:
- **Webhook Receiver**: Nhận POST request tại webhook path `events` (`http://localhost:5678/webhook/events` hoặc `http://localhost:5678/webhook-test/events`).
- **Validate Event Envelope**: Kiểm tra các trường bắt buộc của CIM envelope (`event_id`, `event_type`).
- **Acknowledge Event (200 OK)**: Trả về HTTP 200 kèm JSON confirmation:
  ```json
  {
    "status": "received",
    "event_id": "<event_id>",
    "event_type": "<event_type>",
    "run_id": "mock-run-001",
    "message": "Mock payload accepted"
  }
  ```
- **Reject Invalid Event (422)**: Trả về HTTP 422 nếu payload thiếu trường bắt buộc.
- **Pin Data**: Chứa sẵn fixture event `incident.reported` để chạy thử trực tiếp trong canvas n8n mà không cần backend đang hoạt động.

### Import workflow giả lập bằng CLI

```powershell
docker compose cp workflows/mock-event-receiver.json n8n:/tmp/cim-mock-event-receiver.json
docker compose exec -T n8n n8n import:workflow --input=/tmp/cim-mock-event-receiver.json
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n execute --id=CIMMockEventReceiver001
```

Workflow nghiệp vụ thực tế (gọi lại backend `/internal/events/{id}/evaluate` và gửi email) sẽ được hoàn thiện theo lộ trình tích hợp W5-W8.
