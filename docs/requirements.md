# Yêu cầu phát triển ban đầu

Đặc tả nghiệp vụ A01–A12, gồm actor, user story, form, quyền, trạng thái và dữ liệu demo, nằm tại [Phần A — Yêu cầu và nghiệp vụ](phan-a-yeu-cau-nghiep-vu.md). Đây là baseline cho **demo dùng dữ liệu giả**; các xác nhận từ giảng viên/trường được liệt kê cuối tài liệu đó.

## Yêu cầu đã chọn cho khung dự án

| Mã | Yêu cầu | Trạng thái |
| --- | --- | --- |
| F01 | React/TypeScript hiển thị trang mở đầu và kiểm tra liveness API | Đã có source; lint/build được kiểm tra |
| F02 | FastAPI có health live/ready và API docs | Đã có; test health/CORS được kiểm tra |
| F03 | PostgreSQL, SQLAlchemy và Alembic có nền tảng identity | Đã có model/migration; PostgreSQL Docker, migration và alembic check đã đạt |
| F04 | Docker Compose local cho frontend/backend/DB/n8n | Đã build/chạy Docker; bốn dịch vụ healthy và migration exit 0 |
| F05 | Git ignore, format và hướng dẫn chạy/kiểm tra | Đã có; kiểm tra được chạy cục bộ |

## Yêu cầu nghiệp vụ tiếp theo

| Nhóm | Nội dung | Mảng trong kế hoạch mới |
| --- | --- | --- |
| Xác thực | Bearer session, provision, logout và vô hiệu hóa | N1 |
| Phân quyền | Vai trò + phạm vi bộ phận + chủ sở hữu bản ghi/file | N1; mỗi API của N2–N5 áp dụng policy |
| Tiếp nhận | Ba form theo loại, validation và evidence | N2 backend, N6 frontend |
| Phân loại | Rule version, severity/priority, giải thích và fallback | N3 backend, N7 giao diện triage |
| Xử lý | Phân công, tiếp nhận, trạng thái, resolution và history | N4 backend, N7 frontend |
| Workflow | Outbox, API nội bộ, n8n, thông báo và retry | N5 |
| SLA | Ngưỡng phản hồi, deadline, escalation và chống race | N3 logic, N5 schedule/email, N7 hiển thị |
| Bàn giao | E2E, backup/restore, demo và kết quả đo | Mỗi mảng tự kiểm thử; mốc ghép W11–W12 |

Các chức năng nghiệp vụ ở trạng thái kế hoạch; việc hoàn thiện đặc tả phần A không có nghĩa chức năng đã được lập trình. Không dùng trang starter làm bằng chứng chức năng đã hoàn thành.
