# N4 — Hợp đồng và bàn giao W1

Nguồn: [API contract](api-contract.md), [phần A](phan-a-yeu-cau-nghiep-vu.md),
[kế hoạch N4](KE_HOACH_CONG_VIEC.md). Các đường dẫn API có prefix `/api/v1`.

## Ma trận thao tác

| Thao tác | Trạng thái | Quyền | Dữ liệu / kết quả |
| --- | --- | --- | --- |
| assign | reported → assigned; phân công lại giữ trạng thái | Manager bộ phận hiện tại | department_id, handler_id hoặc null, reason; handler hợp lệ thuộc bộ phận đích |
| acknowledge | assigned → in_progress | Handler được giao hoặc manager cùng bộ phận | Ghi acknowledged_at một lần |
| transitions | in_progress → resolved | Handler được giao hoặc manager cùng bộ phận | resolution không rỗng |
| transitions | resolved → closed | Manager cùng bộ phận | reason xác nhận hoặc null |
| transitions | resolved → in_progress | Manager cùng bộ phận | reason bắt buộc |
| transitions | closed → in_progress | Manager cùng bộ phận | reason bắt buộc; giữ timestamp/history cũ |
| disposition | Mọi trạng thái chưa closed → closed | Manager cùng bộ phận | duplicate/invalid, reason; duplicate cần incident gốc |
| comment public | Incident trong phạm vi xem | Reporter sở hữu, handler được giao, manager bộ phận | body 1–2000 ký tự |
| comment internal | Incident trong phạm vi xem | Handler được giao, manager bộ phận | Reporter không được đọc/tạo; không gửi trong email |

Mọi lệnh thay đổi bắt buộc expected_version nguyên dương. Ngoài phạm vi xem:
404; xem được nhưng không có quyền thao tác: 403; cạnh trạng thái sai: 409
invalid_transition; version cũ: 409 version_conflict; field sai/thiếu: 422.
Admin không mặc định có quyền xử lý. Service dùng API nội bộ của N5, không dùng
endpoint user. UI hiển thị comment dưới dạng text, không render HTML người nhập.

## Sản phẩm hiện có

- `backend/app/workflow/contracts.py`: schema request và kiểm tra các cạnh
  `/transitions` độc lập. Hàm nhận incident đã qua kiểm tra phạm vi của N1.
- `backend/app/comments/contracts.py`: schema comment; chưa có lọc visibility.
- `backend/tests/fixtures/n4_workflow.json`: dữ liệu giả và request/response mẫu
  cho N1/N2/N7 tham khảo. Principal/Incident chỉ là fixture, không thay model N1/N2.
- `backend/tests/test_workflow_contracts.py`: test ma trận 25 cặp trạng thái,
  quyền vai trò, text bắt buộc, version và field lạ.

Chưa có router nghiệp vụ, repository, migration hoặc transaction. Validation
version trong schema không thay cho kiểm tra atomic khi ghi DB.

## Điều kiện tích hợp và tuần tiếp theo

W2 thêm migration riêng cho assignment/comment/history/audit; không sửa revision
identity. Chốt FK incident với N2 trước khi tạo migration phụ thuộc bảng incident.
N1 cung cấp Principal/Policy; N2 cung cấp incident/version; N3 phối hợp race
acknowledgment/SLA; N5 nhận event trong transaction; N7 dùng request mẫu cho UI.

Mỗi command phải ghi incident, history/audit và event cần thiết trong một
transaction; thất bại không được ghi nửa chừng. Hai command cùng version: đúng
một thành công, một 409. Assign không reset acknowledged_at hoặc đồng hồ SLA;
reopen không tạo SLA tiếp nhận mới.

Điểm cần chốt khi làm W4: contract chưa liệt kê đầy đủ trạng thái được phép
phân công lại (đặc biệt resolved/closed). Không tự thêm cạnh chuyển trạng thái;
ghi quyết định vào contract và bổ sung test trước tích hợp.
