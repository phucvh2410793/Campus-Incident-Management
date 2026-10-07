# Workflow n8n

`health-check.json` là workflow mẫu **inactive**: Manual Trigger → HTTP GET backend liveness. Không có credentials hoặc xử lý incident. Workflow đã được import và chạy thành công trên n8n Docker; HTTP node nhận `status=ok` từ backend. ID mẫu: `CIMHealthCheck001`. Workflow vẫn inactive và chỉ chạy thủ công.

## Import mẫu khi n8n đã chạy

1. Mở `http://localhost:5678`, tạo owner account lần đầu.
2. Tạo workflow và chọn import từ file `health-check.json`.
3. Với n8n trong Compose, URL backend là `http://backend:8000/api/v1/health/live`.
4. Nếu n8n ở ngoài Docker, sửa URL về backend tương ứng.
5. Chạy thủ công, kiểm tra response `status=ok`.

Workflow nghiệp vụ sẽ bổ sung sau D09/F02. Đặt tên file theo chức năng, export khi thay đổi, bỏ credentials/tokens/headers nhạy cảm và dữ liệu execution được pin trước khi commit. Import JSON không tự tạo secrets: cấu hình credentials trong n8n riêng theo từng môi trường.

n8n hiện sử dụng SQLite trong `n8n_data` cho dữ liệu nội bộ. PostgreSQL trong Compose là database ứng dụng. Khi cần scale n8n, thiết kế database riêng và migration/backup riêng.

## Import và chạy bằng CLI

```powershell
docker compose cp workflows/health-check.json n8n:/tmp/cim-health-check.json
docker compose exec -T n8n n8n import:workflow --input=/tmp/cim-health-check.json
docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n execute --id=CIMHealthCheck001
```

Cổng broker 5680 chỉ dùng cho process CLI để tránh xung đột broker của n8n server. Chạy lần hai sẽ dùng cùng ID mẫu. Không sử dụng ID này cho workflow nghiệp vụ khác.

Image n8n hiện báo thiếu Python task runner nội bộ. Hai node Manual Trigger/HTTP Request không cần Python nên workflow mẫu vẫn đạt. Nếu sau này cần Python Code node, thiết lập external task runner riêng; Python backend không thay thế runner của n8n.
