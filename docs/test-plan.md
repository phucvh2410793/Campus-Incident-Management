# Kế hoạch kiểm thử

## Kiểm tra tự động

| Thành phần | Kiểm tra | Giới hạn |
| --- | --- | --- |
| Frontend | oxlint, TypeScript/Vite build và mock API N6–N7 | E2E trình duyệt thuộc các tuần sau |
| Backend | Ruff lint/format, pytest auth/policy, fixture và contract | Test auth API dùng PostgreSQL test riêng |
| HTTP integration | Script khởi động API và Vite, kiểm tra HTML và proxy health | Không render trình duyệt hoặc kiểm tra PostgreSQL |
| Migration | Upgrade head trên PostgreSQL Docker | Model incident/evidence/idempotency có migration ở W2 |
| Compose | Build/up --wait, bốn dịch vụ healthy và migration exit 0 | Chỉ môi trường phát triển local |

## Ca test health/CORS

1. Liveness vẫn trả 200 khi DB down.
2. Readiness trả 503 mà không lộ thông tin kết nối.
3. Readiness trả 200 khi kiểm tra DB thành công.
4. CORS không cho origin ngoài danh sách.

T01–T06 và T10–T12 có fixture/unit test ở W1. Khi API nghiệp vụ và workflow được nối vào, chạy lại T01–T18 trên hệ thống đầy đủ, gồm quyền truy cập và E2E.

## Tình huống nghiệm thu nghiệp vụ

| Mã ca | Tình huống | Kết quả cần chứng minh |
| --- | --- | --- |
| T01 | Rò nước nhỏ, không gần điện | Kết quả theo rule `demo-v1`, đúng bộ phận, có lý do và thông báo |
| T02 | Rò nước gần thiết bị điện | Ưu tiên được nâng đúng theo rule, không mất dữ liệu form |
| T03 | Nguy hiểm điện có khói/tia lửa | Đánh giá đúng, cảnh báo ưu tiên cao và hướng dẫn liên hệ khẩn cấp đã xác nhận |
| T04 | Email nghi phishing, chưa tương tác | Chuyển IT; không tự xếp giống trường hợp đã lộ mật khẩu |
| T05 | Phishing, đã nhập mật khẩu | Ưu tiên theo rule `demo-v1`, chuyển IT và có timeline |
| T06 | Thiếu câu trả lời bắt buộc hoặc không khớp rule | Validation đúng; trường hợp hợp lệ nhưng chưa phân loại được vào hàng chờ thủ công |
| T07 | Reporter đổi ID để đọc/sửa/tải file người khác | Backend từ chối; không lộ nội dung trong response, email hoặc log |
| T08 | Handler/manager khác bộ phận thử truy cập | Quyền đúng ma trận trong API contract |
| T09 | Người không có quyền đóng/mở lại | API chặn; người có quyền cần cung cấp lý do theo transition |
| T10 | Chưa tiếp nhận đến deadline | Escalation đúng trong khoảng trễ của chu kỳ kiểm tra được cấu hình |
| T11 | Đã tiếp nhận trước deadline | Không escalation cho SLA tiếp nhận |
| T12 | Tiếp nhận đồng thời lúc job SLA chạy | Không tạo escalation sai do race condition |
| T13 | Event/webhook được gửi hai lần | Không nhân đôi phân công, lịch sử hoặc thông báo |
| T14 | n8n dừng khi người dùng gửi báo cáo | Incident vẫn lưu; event xử lý lại khi n8n hoạt động; UI phản ánh đang chờ |
| T15 | Email/API lỗi giữa workflow | Có lịch sử lỗi, retry có giới hạn và khả năng xử lý thủ công |
| T16 | Hai staff cùng chuyển trạng thái | Kết quả nhất quán; thao tác thua nhận phản hồi xung đột rõ |
| T17 | File sai loại, quá lớn, tên nguy hiểm hoặc có script | Bị chặn theo chính sách; không thực thi, không tải công khai, không để file mồ côi |
| T18 | Restart/restore hệ thống và import workflow sạch | Incident, quyền, history và cấu hình cần thiết được phục hồi theo runbook |

## Trách nhiệm kiểm thử theo 7 mảng

Mỗi mảng viết test cùng lúc với code, dùng fixture/mock từ API contract. Ca xuyên nhiều mảng cần một người tổng hợp kết quả; lỗi thuộc mảng nào thì mảng đó sửa.

Fixture độc lập T01–T06 và T10–T12 cho N2/N4/N7 ở [N3 W1](n3-fixtures.md).

| Ca | Chịu trách nhiệm chính | Mảng phối hợp |
| --- | --- | --- |
| T01–T06 · form, rule, fallback | N3 · phân loại/triage | N2 · dữ liệu đầu vào; N6 · form; N5 · thông báo |
| T07–T09 · xác thực và quyền | N1 · tài khoản/quyền | N2 · incident/file; N4 · thao tác xử lý; N7 · UI staff |
| T10–T12 · deadline và race SLA | N3 · SLA | N4 · acknowledgment; N5 · job/thông báo |
| T13–T15 · event, n8n và retry | N5 · tự động hóa | N2 · outbox khi tạo; N3/N4 · tác động nghiệp vụ |
| T16 · cập nhật đồng thời và E2E staff | N4 · vòng đời xử lý | N7 · E2E giao diện; N1 · quyền |
| T17 · file và input độc hại | N2 · evidence/validation | N6 · giao diện upload; N1 · quyền |
| T18 · khôi phục hệ thống | N1 · PostgreSQL/runbook | N2 · evidence; N5 · n8n/workflow |

N6 và N7 còn chịu trách nhiệm E2E riêng cho luồng reporter và staff trong W10; W11 thử dựng sạch/khôi phục, W12 chạy regression T01–T18 trước hạn 03/01/2027. Từ 04/01 đến 12/01 chỉ ôn tập và chuẩn bị bảo vệ theo [kế hoạch](KE_HOACH_CONG_VIEC.md).

## Xác minh Docker runtime

Sau khi Compose chạy, kiểm tra health API, frontend proxy và n8n. Script `scripts/verify-docker.ps1` còn chạy `alembic check`, nên dùng đầy đủ sau migration N2 ở W2; xem [hướng dẫn phát triển](development.md). Health check không thay cho test luồng incident.
