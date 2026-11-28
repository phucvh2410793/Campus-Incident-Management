# N5 Runbook: Dựng Môi Trường n8n Sạch, Cấu Hình Credentials, Import Workflow, Kiểm Tra Hàng Chờ Lỗi và Phục Hồi Sự Cố

Tài liệu này là hướng dẫn vận hành chuẩn (Standard Operating Procedure - SOP) cho mảng **N5 — n8n, outbox & thông báo** thuộc hệ thống Quản lý sự cố khuôn viên trường (Campus Incident Management - CIM), đáp ứng mục tiêu nghiệm thu **W11**:
> *"Người khác dựng n8n sạch, test email giả và xử lý event lỗi."*

---

## Mục lục

1. [Tổng quan kiến trúc tự động hóa N5](#1-tổng-quan-kiến-trúc-tự-động-hóa-n5)
2. [Dựng môi trường n8n hoàn toàn mới (Clean Setup)](#2-dựng-môi-trường-n8n-hoàn-toàn-mới-clean-setup)
3. [Cấu hình Credentials riêng biệt ngoài Git](#3-cấu-hình-credentials-riêng-biệt-ngoài-git)
4. [Danh mục và Import 4 Workflow nghiệp vụ](#4-danh-mục-và-import-4-workflow-nghiệp-vụ)
5. [Kiểm tra hàng chờ lỗi (Dead-Letter Queue Inspection)](#5-kiểm-tra-hàng-chờ-lỗi-dead-letter-queue-inspection)
6. [Quy trình phục hồi hệ thống và xử lý sự cố (Recovery Procedures)](#6-quy-trình-phục-hồi-hệ-thống-và-xử-lý-sự-cố-recovery-procedures)
7. [Kịch bản kiểm thử nghiệm thu mẫu (Acceptance Test Scenarios)](#7-kịch-bản-kiểm-thử-nghiệm-thu-mẫu-acceptance-test-scenarios)
8. [Khắc phục sự cố thường gặp (Troubleshooting FAQ)](#8-khắc-phục-sự-cố-thường-gặp-troubleshooting-faq)

---

## 1. Tổng quan kiến trúc tự động hóa N5

Hệ thống N5 chịu trách nhiệm bảo đảm thông điệp và sự kiện được luân chuyển an toàn giữa Backend nghiệp vụ (FastAPI), hàng đợi Outbox (PostgreSQL) và nền tảng tự động hóa (n8n):

```text
+-----------------------------------------------------------------------------------+
| BACKEND NGHIỆP VỤ (FastAPI)                                                      |
|   N2 (Reported)  --> OutboxEventPublisher ---> +-------------------------------+  |
|   N3 (SLA Check) --> OutboxEventPublisher ---> | outbox_events (status=pending)|  |
|   N4 (Assigned)  --> OutboxEventPublisher ---> +---------------+---------------+  |
+------------------------------------------------------------------|----------------+
                                                                   |
                                                      Claim Lease / Dispatch
                                                                   v
+------------------------------------------------------------------+----------------+
| N5 WORKER / DISPATCHER (app.automation.worker)                                    |
|   - Claim lease (status=processing, lease_token, lease_expires_at)                |
|   - Ký HMAC-SHA256 (X-CIM-Signature, X-CIM-Timestamp, X-CIM-Event-ID)             |
|   - Exponential Backoff khi gặp lỗi mạng / n8n down                               |
|   - Dead-letter queue khi quá max_attempts hoặc lỗi 4xx unrecoverable             |
+------------------------------------------------------------------+----------------+
                                                                   |
                                                  HTTP POST Webhook (Raw Body)
                                                                   v
+------------------------------------------------------------------+----------------+
| N8N ENGINE (Docker Container: port 5678)                                          |
|                                                                                   |
|   [1] health-check.json          --> Manual Trigger -> GET /api/v1/health/live    |
|   [2] event-processor.json       --> Webhook /events -> Verify -> Deduplicate ->  |
|                                      POST /internal/events/{id}/evaluate -> Done  |
|   [3] notification-processor.json--> Webhook /notifications -> Safe Email Guard ->|
|                                      POST /internal/notifications/dispatch        |
|   [4] sla-check.json             --> Schedule (1m) -> POST /internal/sla/check    |
+------------------------------------------------------------------+----------------+
                                                                   |
                                       Service Bearer Header Auth  |
                                       (CIM Internal Service Bearer)
                                                                   v
+------------------------------------------------------------------+----------------+
| BACKEND INTERNAL APIS (/internal/*)                                              |
|   - /internal/webhooks/verify        : Kiểm tra chữ ký HMAC & timestamp skew      |
|   - /internal/events/{id}            : Kiểm tra trùng lặp (duplicate check)       |
|   - /internal/events/{id}/evaluate   : Đánh giá nghiệp vụ N2/N3/N4                |
|   - /internal/notifications/dispatch : Gửi email thử nghiệm (Content Safety Guard)|
|   - /internal/sla/check              : Quét SLA quá hạn và leo thang (Báo 1 lần)  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Dựng môi trường n8n hoàn toàn mới (Clean Setup)

### 2.1. Yêu cầu tiên quyết
- **Docker & Docker Compose** (hoặc Podman) đã cài đặt trên máy chủ / máy trạm.
- Môi trường Backend (FastAPI) và PostgreSQL đang chạy ổn định.
- Cổng `5678` (n8n Web UI & Webhooks) và cổng `8000` (Backend) chưa bị tiến trình khác chiếm dụng.

### 2.2. Chuẩn bị môi trường sạch
Trên máy hoặc Compose project mới, `docker compose up -d n8n` sẽ tạo volume n8n trống. Nếu đã có n8n đang chạy, hãy dùng tiếp dữ liệu hiện tại hoặc tạo một Compose project thử nghiệm riêng; không xóa volume của hệ thống đang dùng. Trước khi import lại workflow, kiểm tra các workflow có cùng ID trong n8n để tránh ghi đè cấu hình đã chỉnh trên UI.

### 2.3. Khởi chạy n8n bằng Docker Compose
Dự án đã định nghĩa dịch vụ `n8n` chuẩn tại `compose.yaml`:

```powershell
docker compose up -d n8n
```

Kiểm tra trạng thái sẵn sàng (healthcheck):
```powershell
# Xem tiến trình container
docker compose ps n8n

# Kiểm tra endpoint liveness (trả về HTTP 200 OK)
curl -I http://localhost:5678/healthz
```

### 2.4. Khởi tạo Owner Account lần đầu trên n8n UI
1. Mở trình duyệt web tại: `http://localhost:5678`.
2. Màn hình chào mừng của n8n sẽ yêu cầu thiết lập tài khoản quản trị viên sở hữu (**Owner Account**):
   - **Email**: nhập địa chỉ email quản trị (ví dụ: `admin@cim.edu.vn` hoặc `dev@local.invalid`).
   - **First Name / Last Name**: `CIM Admin`.
   - **Password**: đặt mật khẩu quản trị bảo mật (tối thiểu 8 ký tự).
3. Nhấp chọn **Next** / **Get Started** để hoàn tất khởi tạo. Môi trường n8n lúc này là sạch hoàn toàn (0 workflows, 0 credentials).

---

## 3. Cấu hình Credentials riêng biệt ngoài Git

Theo chính sách an ninh của dự án: **Tuyệt đối không commit credentials, secret key hoặc token thật vào Git**. Mọi bí mật được lưu trữ trong biến môi trường hoặc nhập trực tiếp qua giao diện quản trị n8n.

### 3.1. Danh mục các thông số bí mật cần thiết

| Tên biến / Thông số | Nơi cấu hình | Ý nghĩa & Quy cách |
| --- | --- | --- |
| `CIM_INTERNAL_SERVICE_BEARER_TOKENS` | `.env` của Backend | Danh sách Bearer token nội bộ, ngăn chặn token người dùng thông thường gọi `/internal/*`. Ví dụ: `cim-internal-token-secret-change-me` |
| `CIM_WEBHOOK_HMAC_SECRET` | `.env` của Backend | Chuỗi secret bí mật dùng ký HMAC-SHA256 trên webhook payload gửi sang n8n. |
| `CIM Internal Service Bearer` | n8n Credentials (UI / CLI) | Header Auth credential trên n8n, tự động đính kèm header `Authorization: Bearer <token>` khi n8n gọi lại Backend. |
| `MOCK_EMAIL_SENDING` | `.env` của Backend | Mặc định `true` trong môi trường dev/test để ghi log email an toàn thay vì gửi SMTP thật. |

### 3.2. Tạo Header Auth Credential trên giao diện n8n Web UI

1. Trên menu bên trái của n8n, chọn biểu tượng chìa khóa **Credentials** (hoặc truy cập `http://localhost:5678/credentials`).
2. Nhấp chọn **Add Credential** (hoặc nút **New Credential** màu cam ở góc trên bên phải).
3. Trong ô tìm kiếm loại Credential, gõ: `Header Auth`.
4. Điền các trường thông tin chuẩn xác như sau:
   - **Credential Name**: `CIM Internal Service Bearer` *(Lưu ý: đặt chính xác tên này để các node HTTP trong workflow tự động liên kết)*.
   - **Name**: `Authorization`.
   - **Value**: `Bearer cim-internal-token-secret-change-me` *(hoặc giá trị token trùng khớp với biến `CIM_INTERNAL_SERVICE_BEARER_TOKENS` trong file `.env` của backend)*.
5. Nhấp **Save** để lưu lại credential.

*(Ghi chú: Nếu sử dụng n8n CLI để import, ID nội bộ của credential này nên đặt là `cim-internal-service-bearer`)*.

---

## 4. Danh mục và Import 4 Workflow nghiệp vụ

Dự án cung cấp sẵn 4 workflow hoàn chỉnh định dạng JSON chuẩn trong thư mục `workflows/`:

| STT | Tập tin | Tên Workflow | ID Mẫu | Loại Trigger | URL / Webhook Path | Credential Yêu Cầu |
| :---: | :--- | :--- | :---: | :---: | :--- | :--- |
| **1** | `workflows/health-check.json` | Campus Incident Management - Backend health check | `CIMHealthCheck001` | Manual Trigger | `GET /api/v1/health/live` | Không |
| **2** | `workflows/event-processor.json` | Campus Incident Management - Event Processor & Deduplication (N5 W5) | `CIMEventProcessor001` | Webhook (Raw Body) | `POST /webhook/events` | `CIM Internal Service Bearer` |
| **3** | `workflows/notification-processor.json` | Campus Incident Management - Notification Processor & Test Email (N5 W6-W7) | `CIMNotificationProcessor001` | Webhook (JSON Body) | `POST /webhook/notifications` | `CIM Internal Service Bearer` |
| **4** | `workflows/sla-check.json` | Campus Incident Management - SLA Schedule Check (N5 W8) | `CIMSlaScheduleCheck001` | Schedule Trigger (1 min) | `POST /internal/sla/check` | `CIM Internal Service Bearer` |

---

### 4.1. Quy trình Import qua giao diện Web UI n8n

Thực hiện lần lượt cho từng workflow:
1. Truy cập `http://localhost:5678/workflows`.
2. Nhấp chọn nút **Add workflow** (hoặc dấu `+`).
3. Mở menu tùy chọn `...` ở góc trên bên phải canvas -> Chọn **Import from file...**.
4. Chọn file JSON tương ứng từ thư mục `workflows/` trên máy tính:
   - `workflows/health-check.json`
   - `workflows/event-processor.json`
   - `workflows/notification-processor.json`
   - `workflows/sla-check.json`
5. Sau khi canvas nạp các node:
   - Mở các node **HTTP Request** (ví dụ: `Verify Signature`, `Dispatch Safe Email`, `Check Overdue SLA`).
   - Kiểm tra mục **Authentication**: Chọn `Predefined Credential Type` -> `Header Auth` -> Chọn credential `CIM Internal Service Bearer` đã tạo ở Mục 3.2.
   - Kiểm tra URL Backend: Mặc định là `http://backend:8000/...` (dành cho container trong Docker Compose). Nếu chạy Backend trực tiếp trên máy host, đổi thành `http://host.docker.internal:8000/...` hoặc IP tương ứng.
6. Gạt công tắc chuyển đổi góc trên bên phải từ **Inactive** sang **Active** (Publish workflow).

---

### 4.2. Quy trình Import và Publish tự động bằng n8n CLI

Bạn có thể import và kích hoạt toàn bộ 4 workflow tự động bằng Docker CLI mà không cần thao tác thủ công:

```powershell
# 1. Sao chép các file workflow vào container n8n
docker compose cp workflows/health-check.json n8n:/tmp/health-check.json
docker compose cp workflows/event-processor.json n8n:/tmp/event-processor.json
docker compose cp workflows/notification-processor.json n8n:/tmp/notification-processor.json
docker compose cp workflows/sla-check.json n8n:/tmp/sla-check.json

# 2. Import lần lượt vào n8n database
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n import:workflow --input=/tmp/health-check.json
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n import:workflow --input=/tmp/event-processor.json
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n import:workflow --input=/tmp/notification-processor.json
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n import:workflow --input=/tmp/sla-check.json

# 3. Kích hoạt (Publish) các workflow nghiệp vụ
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n publish:workflow --id=CIMEventProcessor001
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n publish:workflow --id=CIMNotificationProcessor001
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n publish:workflow --id=CIMSlaScheduleCheck001

# 4. Khởi động lại n8n để nạp đầy đủ các webhook production
docker compose restart n8n
```

*(Lưu ý: Biến môi trường `N8N_RUNNERS_BROKER_PORT=5680` là bắt buộc khi thực thi lệnh CLI trong container để tránh xung đột cổng task runner broker với tiến trình n8n server chính đang chạy).*

---

## 5. Kiểm tra hàng chờ lỗi (Dead-Letter Queue Inspection)

Hệ thống N5 phân tách hàng chờ lỗi làm 2 phân vùng độc lập:
1. **Outbox Dead-Letter Queue (`outbox_events`)**: Chứa các sự kiện không thể gửi tới n8n sau tối đa 5 lần thử (exponential backoff) hoặc bị từ chối bởi lỗi HTTP 4xx vĩnh viễn.
2. **Notification Queue (`notifications`)**: Chứa các yêu cầu gửi email ở trạng thái `failed` (địa chỉ không hợp lệ, lỗi nhà cung cấp mail) hoặc `uncertain` (mất kết nối giữa chừng).

### 5.1. Tra cứu qua Backend REST API

Người vận hành có Service Bearer token có thể truy vấn nhanh. Lấy token từ cấu hình riêng của môi trường; không ghi token vào tài liệu hoặc lịch sử lệnh:

```powershell
$headers = @{ "Authorization" = "Bearer $env:CIM_INTERNAL_SERVICE_TOKEN" }

# 1. Xem danh sách các outbox event bị rơi vào dead-letter
Invoke-RestMethod -Uri "http://localhost:8000/internal/events/failed?limit=50" -Headers $headers -Method Get | ConvertTo-Json

# 2. Xem thống kê tổng hợp số lượng lỗi dead-letter và uncertain
Invoke-RestMethod -Uri "http://localhost:8000/internal/dead-letter/summary" -Headers $headers -Method Get | ConvertTo-Json
```

Dữ liệu trả về mẫu:
```json
{
  "failed_outbox_count": 2,
  "failed_notifications_count": 1,
  "uncertain_notifications_count": 1,
  "total_dead_letter_count": 4
}
```

### 5.2. Tra cứu qua Worker CLI

Từ thư mục gốc repo, quản trị viên có thể sử dụng công cụ dòng lệnh chuyên dụng:

```powershell
# 1. Liệt kê tất cả outbox event bị dead-letter
backend\.venv\Scripts\python.exe -m app.automation.run_worker --list-failed

# 2. Liệt kê thông báo bị thất bại vĩnh viễn (failed)
backend\.venv\Scripts\python.exe -m app.automation.run_worker --list-notifications --status failed

# 3. Liệt kê thông báo đang trong trạng thái mơ hồ (uncertain)
backend\.venv\Scripts\python.exe -m app.automation.run_worker --list-notifications --status uncertain
```

### 5.3. Bất biến quan trọng về trạng thái `uncertain`
> **QUY TẮC BẤT BIẾN AN TOÀN**:
> Trạng thái `uncertain` xảy ra khi hệ thống đã phát request gửi mail nhưng bị ngắt kết nối mạng hoặc timeout trước khi nhận được phản hồi xác nhận.
> **Tuyệt đối không có bất kỳ worker nền hay tiến trình tự động nào được phép tự động retry bản ghi `uncertain`**.
> Điều này ngăn chặn triệt để nguy cơ người nhận (đặc biệt là người báo sự cố) nhận thư rác lặp đi lặp lại. Việc gửi lại bắt buộc phải có sự kiểm tra và can thiệp thủ công từ quản trị viên.

---

## 6. Quy trình phục hồi hệ thống và xử lý sự cố (Recovery Procedures)

### 6.1. Khắc phục sự cố Worker bị dừng đột ngột (Crash / Unclean Shutdown Recovery)

Khi worker bị kill đột ngột (SIGKILL, mất điện, máy chủ sập nguồn), các sự kiện đang được xử lý sẽ bị kẹt ở trạng thái `status = 'processing'` kèm `lease_token`.

**Cách xử lý**:
Chạy cờ `--recover` của worker để tự động rà soát và giải phóng tất cả các bản ghi có lease đã hết hạn:

```powershell
backend\.venv\Scripts\python.exe -m app.automation.run_worker --recover
```

Hệ thống sẽ:
1. Quét tất cả các bản ghi `processing` có `lease_expires_at <= now()`.
2. Đưa trạng thái trở lại `pending`.
3. Đặt thời điểm xử lý `next_attempt_at = now()`.
4. Xóa `lease_token` và `lease_expires_at` để worker mới có thể tiếp nhận xử lý ngay lập tức.

---

### 6.2. Admin can thiệp Re-queue Dead-Letter Event (Bắt buộc kèm `--reason`)

Để bảo đảm tính minh bạch kiểm toán (Audit Trail), **bất kỳ thao tác retry thủ công nào từ phía quản trị viên đều bắt buộc phải cung cấp lý do (`--reason`)**. Nếu không có `--reason`, CLI sẽ từ chối thực hiện.

#### 6.2.1. Retry Outbox Event
Khi n8n bị sập kéo dài hoặc webhook URL bị đổi, các event quá hạn thử nghiệm sẽ nằm ở `failed`. Sau khi n8n hoạt động trở lại:

```powershell
# Thực hiện retry (bắt buộc truyền --reason)
backend\.venv\Scripts\python.exe -m app.automation.run_worker `
  --retry-event 2ee24992-34d3-4955-9e5c-f7446fd42393 `
  --reason "Đã phục hồi container n8n và sửa cấu hình webhook"
```

Lệnh này sẽ đưa event từ `failed` về `pending`, đặt lại `attempt_count = 0` và lưu lý do vào trường `error_message`.

#### 6.2.2. Retry Notification (Failed hoặc Uncertain)
Sau khi quản trị viên đã liên hệ với người nhận và xác nhận họ chưa nhận được email:

```powershell
backend\.venv\Scripts\python.exe -m app.automation.run_worker `
  --retry-notification 5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b `
  --reason "Xác nhận trực tiếp với người dùng chưa nhận được email thông báo"
```

Thông báo sẽ được đưa về `pending` để gửi lại một cách an toàn.

---

## 7. Kịch bản kiểm thử nghiệm thu mẫu (Acceptance Test Scenarios)

Người kiểm thử hoặc đánh giá độc lập có thể thực hiện 5 kịch bản dưới đây để kiểm chứng tính sẵn sàng của hệ thống.

---

### Kịch bản 1: Kiểm thử gửi Email giả lập an toàn (Mock Email Dispatch)

**Mục tiêu**: Kiểm tra kịch bản thông báo hoạt động, tuân thủ Content Safety Guard, và không gửi lặp.

1. **Gửi yêu cầu thông báo mới qua webhook n8n**:
```powershell
$payload = @{
  event_id = [guid]::NewGuid().ToString()
  scenario = "reported"
  recipient_user_id = "10000000-0000-4000-8000-000000000001"
  recipient_email = "reporter@demo.invalid"
  incident_id = "2ee24992-34d3-4955-9e5c-f7446fd42393"
  category = "incident.reported"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "http://localhost:5678/webhook/notifications" -Method Post -Body $payload -ContentType "application/json"
```

2. **Kết quả mong đợi**:
   - HTTP 200 OK.
   - Response: `{"status": "sent", "was_newly_sent": true, "provider_message_id": "mock-msg-..."}`.

3. **Kiểm tra chống gửi lặp (Idempotency)**:
   - Gửi lại chính xác payload trên lần thứ hai.
   - Response: `{"status": "skipped", "was_newly_sent": false, "provider_message_id": "mock-msg-..."}`.
   - Không có email trùng lặp nào được phát đi.

4. **Kiểm tra bộ lọc an toàn (Content Safety Guard)**:
   - Gửi yêu cầu với `scenario = "public_state_updated"` nhưng cố tình đưa ghi chú nội bộ `[internal]` hoặc đường dẫn `/staff/*`.
   - Kết quả: Webhook trả về lỗi HTTP 422 Unprocessable Entity kèm thông báo vi phạm an toàn, email bị chặn phát.

---

### Kịch bản 2: Kiểm thử gửi Event đã ký HMAC (Signed Webhook Delivery)

**Mục tiêu**: Kiểm chứng xác thực chữ ký HMAC-SHA256 và cơ chế chống trùng lặp.

Sử dụng script tiện ích có sẵn trong kho mã nguồn:

```powershell
# 1. Gửi event hợp lệ
backend\.venv\Scripts\python.exe scripts\send-signed-event.py `
  --url http://localhost:5678/webhook/events `
  --secret "change-me-to-your-local-webhook-secret"

# Kết quả: status=processed, duplicate=false, có run_id.

# 2. Gửi lại cùng event_id vừa gửi (Duplicate Event)
backend\.venv\Scripts\python.exe scripts\send-signed-event.py `
  --url http://localhost:5678/webhook/events `
  --secret "change-me-to-your-local-webhook-secret" `
  --event-id <event_id_vừa_dùng>

# Kết quả: status=processed, duplicate=true, không gọi evaluate lần 2.

# 3. Gửi event với timestamp quá khứ quá 300 giây (Clock Skew Rejection)
backend\.venv\Scripts\python.exe scripts\send-signed-event.py `
  --url http://localhost:5678/webhook/events `
  --secret "change-me-to-your-local-webhook-secret" `
  --timestamp-offset -301

# Kết quả: HTTP 401 Unauthorized (expired_timestamp).
```

---

### Kịch bản 3: Mô phỏng n8n ngoại tuyến và phục hồi (n8n Down Resilience)

1. Dừng container n8n:
   ```powershell
   docker compose stop n8n
   ```
2. Thực hiện hành động phát sinh sự cố mới (ví dụ tạo incident qua API hoặc test script).
3. Chạy outbox worker xử lý:
   ```powershell
   backend\.venv\Scripts\python.exe -m app.automation.run_worker --once
   ```
   - Worker báo lỗi kết nối webhook (`Connection refused`).
   - Sự kiện vẫn nằm trong `outbox_events` ở trạng thái chờ retry; kiểm tra `next_attempt_at` trước khi chạy worker lần nữa.
4. Bật lại n8n:
   ```powershell
   docker compose start n8n
   ```
5. Chờ n8n sẵn sàng và tới thời điểm `next_attempt_at`, sau đó chạy lại worker:
   ```powershell
   backend\.venv\Scripts\python.exe -m app.automation.run_worker --once
   ```
   - Sự kiện được dispatch thành công sang n8n và chuyển sang `status = 'done'`. Dữ liệu nghiệp vụ được xử lý đầy đủ và hoàn tất.

---

### Kịch bản 4: Kích hoạt SLA Check tức thời qua CLI

**Mục tiêu**: Kiểm tra quy trình quét thời hạn SLA và phát sinh leo thang.

```powershell
backend\.venv\Scripts\python.exe -m app.automation.run_worker --check-sla
```

Kết quả hiển thị:
```text
SLA check completed: X incident(s) checked, Y escalation(s) created
```
Nếu có sự cố quá hạn SLA, bản ghi leo thang `escalations` được tạo và sự kiện `sla.escalated` được ghi vào Outbox. Mỗi sự cố chỉ được leo thang một lần cho mỗi cấp độ.

---

## 8. Khắc phục sự cố thường gặp (Troubleshooting FAQ)

### Q1: n8n báo lỗi `Workflow could not be activated` khi import bằng CLI?
- **Nguyên nhân**: n8n có cơ chế task runner broker nội bộ chiếm cổng 5678.
- **Khắc phục**: Khi chạy bất kỳ lệnh `n8n` CLI nào qua `docker compose exec`, luôn truyền thêm biến môi trường `-e N8N_RUNNERS_BROKER_PORT=5680`:
  ```powershell
  docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n publish:workflow --id=<ID>
  ```

### Q2: Node HTTP trong n8n nhận phản hồi `401 Unauthorized` từ Backend?
- **Nguyên nhân**: Token trong Header Auth credential `CIM Internal Service Bearer` không khớp với giá trị `CIM_INTERNAL_SERVICE_BEARER_TOKENS` của Backend.
- **Khắc phục**: Mở `Credentials` trên n8n UI, kiểm tra lại trường `Authorization` có tiền tố `Bearer `, và so sánh với biến môi trường trong file `.env` của backend.

### Q3: Webhook báo lỗi `401 Invalid webhook signature` dù secret đã khớp?
- **Nguyên nhân**: Webhook trigger trong n8n chưa bật tùy chọn **Raw Body**, làm thay đổi thứ tự key hoặc khoảng trắng trong chuỗi JSON, dẫn đến băm SHA256 không khớp.
- **Khắc phục**: Mở node `Webhook Receiver` trong `event-processor.json`, đảm bảo trường `options.rawBody` được gán bằng `true`. Dispatcher ký trực tiếp trên raw bytes này.

### Q4: Node trong n8n không kết nối được `http://backend:8000`?
- **Nguyên nhân**: Nếu n8n chạy trong Docker Compose còn Backend chạy ngoài máy host (PowerShell/VSCode).
- **Khắc phục**:
  - Khi Backend chạy trên máy host: đổi URL trong node HTTP thành `http://host.docker.internal:8000/...`.
  - Khi Backend chạy chung trong Docker Compose: URL `http://backend:8000/...` hoạt động tự động thông qua bridge network.
