# Yêu cầu dự án

Chi tiết vai trò, form, quyền và luồng xử lý nằm trong [yêu cầu nghiệp vụ](business-requirements.md). Demo dùng dữ liệu giả.

## Nền tảng

| Mã | Yêu cầu |
| --- | --- |
| F01 | Frontend React/TypeScript, wireframe N6–N7 và mock API |
| F02 | FastAPI với health API, login/session và API docs |
| F03 | PostgreSQL, SQLAlchemy và Alembic cho identity; model incident/evidence/idempotency |
| F04 | Docker Compose cho frontend, backend, PostgreSQL và n8n trên localhost |
| F05 | Hướng dẫn chạy, lint, format và test |

## Nghiệp vụ

| Nhóm | Nội dung | Mảng phụ trách |
| --- | --- | --- |
| Xác thực | Bearer session, provision, logout và vô hiệu hóa | N1 |
| Phân quyền | Vai trò + phạm vi bộ phận + chủ sở hữu bản ghi/file | N1; mỗi API của N2–N5 áp dụng policy |
| Tiếp nhận | Ba form theo loại, validation và evidence | N2 backend, N6 frontend |
| Phân loại | Rule version, severity/priority, giải thích và fallback | N3 backend, N7 giao diện triage |
| Xử lý | Phân công, tiếp nhận, trạng thái, resolution và history | N4 backend, N7 frontend |
| Workflow | Outbox, API nội bộ, n8n, thông báo và retry | N5 |
| SLA | Ngưỡng phản hồi, deadline, escalation và chống race | N3 logic, N5 schedule/email, N7 hiển thị |
| Bàn giao | E2E, backup/restore, demo và kết quả đo | Mỗi mảng tự kiểm thử; mốc ghép W11–W12 |

Tiến độ và tiêu chí theo từng tuần nằm trong [kế hoạch công việc](KE_HOACH_CONG_VIEC.md).
