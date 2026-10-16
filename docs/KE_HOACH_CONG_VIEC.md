# Kế hoạch công việc Campus Incident Management

**Thời gian:** 12/10/2026–03/01/2027 cho phát triển và kiểm thử. Từ 04/01 đến 12/01/2027 dành cho ôn tập, diễn tập và bảo vệ.

Kế hoạch chia theo bảy mảng N1–N7. Phạm vi MVP gồm rò nước, nguy hiểm điện và phishing.

- Dùng [API contract](api-contract.md), [yêu cầu nghiệp vụ](business-requirements.md) và fixture chung khi viết code/test. N6–N7 dùng mock API trước khi nối backend.
- Khi đổi contract, cập nhật fixture và test liên quan; migration mới thêm revision thay vì sửa revision đã áp dụng.
- W4, W7, W8–W9 và W11 là các mốc tích hợp. Mỗi mảng vẫn phát triển song song từ W1.
- Hoàn thành một đầu việc khi code chạy được và test tương ứng qua.

| Vị trí | Mảng | Công việc chính |
| --- | --- | --- |
| N1 | Tài khoản, quyền & nền dữ liệu | Users, departments, sessions, policy và seed tài khoản. |
| N2 | Tiếp nhận báo cáo & dữ liệu | Incident, answers, idempotency, evidence và API reporter. |
| N3 | Phân loại, triage & SLA | Rule `demo-v1`, priority, deadline và escalation. |
| N4 | Phân công & vòng đời xử lý | Assignment, comment, status transition, history và audit. |
| N5 | n8n, outbox & thông báo | Outbox, dispatcher, API nội bộ, workflow n8n, email demo và retry. |
| N6 | Giao diện người báo | Login, ba form, upload và danh sách/chi tiết reporter. |
| N7 | Giao diện nhân viên & quản lý | Hàng đợi, triage, phân công, xử lý, dashboard và E2E staff. |

## Việc theo từng người và từng tuần

### N1 — Tài khoản, quyền & nền dữ liệu

| Tuần / ngày | Việc của mảng | Hoàn thành khi |
| --- | --- | --- |
| W1 · 12/10/2026–18/10/2026 | Thiết kế bảng user/department/session, ma trận quyền và interface Principal/Policy; tạo fixture bốn vai trò để các mảng dùng chung. | Có ERD, fixture và Principal/Policy chạy độc lập. |
| W2 · 19/10/2026–25/10/2026 | Viết migration bổ sung session, seed tài khoản/bộ phận giả, mật khẩu từ cấu hình ngoài Git. | DB sạch migrate/seed lặp lại không nhân đôi; đủ vai trò và hai bộ phận. |
| W3 · 26/10/2026–01/11/2026 | Làm login, băm mật khẩu và rate limit; trả đúng lỗi 401/429 theo contract. | Test login đúng/sai/khóa/rate limit đạt bằng API thật. |
| W4 · 02/11/2026–08/11/2026 | Làm bearer middleware, /auth/me, logout, hạn phiên và thu hồi khi khóa user. | Token chỉ lưu hash; hết hạn/logout/khóa đều trả 401. |
| W5 · 09/11/2026–15/11/2026 | Đóng gói policy role/owner/department/assignment dùng chung và che 404 khi ngoài phạm vi. | Có test policy qua fixture, các router khác gọi cùng interface. |
| W6 · 16/11/2026–22/11/2026 | Làm quản trị tối thiểu user/department/rule bằng CLI hoặc API có audit. | Tạo/khóa user demo không sửa DB tay; admin xem và thao tác mọi incident theo contract, có audit. |
| W7 · 23/11/2026–29/11/2026 | Ghép policy vào router incident, file, comment và thao tác xử lý tại mốc tích hợp. | Ma trận quyền thực tế đạt; truy cập chéo ID trả 404/403 đúng contract. |
| W8 · 30/11/2026–06/12/2026 | Rà lỗi 401/403/404, thu hồi session và tài khoản đa vai trò trên dữ liệu seed lớn. | Test âm tính theo từng vai trò và bộ phận đều đạt. |
| W9 · 07/12/2026–13/12/2026 | Cố định hợp đồng auth/permission, cập nhật OpenAPI và test tương thích frontend. | UI login/route chạy API thật; không còn endpoint giả trong luồng auth. |
| W10 · 14/12/2026–20/12/2026 | Kiểm tra bảo mật token, log, secrets, rate limit và cấu hình demo. | Không lộ token/mật khẩu trong DB, log, export hoặc repo. |
| W11 · 21/12/2026–27/12/2026 | Viết runbook tài khoản/seed và backup/restore PostgreSQL; thử khôi phục trên DB sạch. | Người khác dựng sạch, phục hồi DB và đăng nhập đủ vai trò theo README. |
| W12 · 28/12/2026–03/01/2027 | Chạy regression auth/quyền, sửa lỗi chặn demo và chuẩn bị bàn giao. | Test auth/quyền xanh trước 04/01. |

### N2 — Tiếp nhận báo cáo & dữ liệu

| Tuần / ngày | Việc của mảng | Hoàn thành khi |
| --- | --- | --- |
| W1 · 12/10/2026–18/10/2026 | Định nghĩa schema incident/answers/evidence/idempotency và fixture ba báo cáo theo API contract; chia sẻ dữ liệu mẫu cho N3–N7. | Có model, JSON fixture và quy ước version, ID, thời gian. |
| W2 · 19/10/2026–25/10/2026 | Viết migration incident/answers/evidence/idempotency, chỉ mục lọc và seed báo cáo giả. | DB sạch migrate, seed lặp lại không nhân đôi và có dữ liệu phân trang. |
| W3 · 26/10/2026–01/11/2026 | Viết validation ba form MVP; từ chối field lạ, reporter_id và dữ liệu không hợp lệ. | Ca hợp lệ/sai/unknown đúng contract, test schema độc lập. |
| W4 · 02/11/2026–08/11/2026 | Làm POST /incidents và Idempotency-Key; dùng cổng phát event để N5 cắm vào sau. | Incident/key/event commit atomic; n8n tắt vẫn tạo được báo cáo. |
| W5 · 09/11/2026–15/11/2026 | Làm GET danh sách/chi tiết theo phạm vi Principal/Policy, cursor và bộ lọc. | Phân trang ổn định; user không thấy incident ngoài quyền. |
| W6 · 16/11/2026–22/11/2026 | Làm bổ sung thông tin, public history và expected_version. | Version cũ trả 409; history đúng và không có ghi nửa chừng. |
| W7 · 23/11/2026–29/11/2026 | Làm upload/list/download bằng chứng qua backend; kiểm MIME thật, cỡ file và quyền. | File sai bị chặn; không public URL, không có file mồ côi. |
| W8 · 30/11/2026–06/12/2026 | Ghép policy N1 và event N5; kiểm tra tạo incident khi automation tắt/lỗi. | API thật chạy với auth; sự cố vẫn được lưu và event không mất. |
| W9 · 07/12/2026–13/12/2026 | Đo latency tạo/danh sách trên seed lớn, tối ưu chỉ mục/lọc; kiểm tra file sau reset. | Ghi môi trường, cỡ mẫu và số đo thật; không rò file/bản ghi chéo user. |
| W10 · 14/12/2026–20/12/2026 | Viết integration test transaction, concurrent 409, upload lỗi và input/script độc hại. | Không mất dữ liệu, không XSS từ dữ liệu trả về, test xanh. |
| W11 · 21/12/2026–27/12/2026 | Viết hướng dẫn migration, seed, lưu/khôi phục evidence và sự cố upload. | Người khác dựng sạch và khôi phục incident/file nhất quán. |
| W12 · 28/12/2026–03/01/2027 | Chạy regression tiếp nhận/file/lịch sử, sửa lỗi chặn demo và đóng băng API. | Luồng reporter từ gửi đến xem lại đạt trước 04/01. |

### N3 — Phân loại, triage & SLA

| Tuần / ngày | Việc của mảng | Hoàn thành khi |
| --- | --- | --- |
| W1 · 12/10/2026–18/10/2026 | Chép T01–T06, T10–T12 thành fixture độc lập; định nghĩa RuleResult và clock giả cho SLA. | Expected result không phụ thuộc code; N2/N4/N7 dùng chung fixture. |
| W2 · 19/10/2026–25/10/2026 | Viết migration rule version/evaluation/escalation và seed demo-v1; dùng incident_id làm ranh giới. | Migration riêng chạy trên DB sạch; rule version và escalation unique. |
| W3 · 26/10/2026–01/11/2026 | Làm engine đánh giá ba loại báo cáo và reason/department/priority theo thứ tự rule. | T01–T05 đạt, cùng input/version cho cùng kết quả. |
| W4 · 02/11/2026–08/11/2026 | Làm fallback unknown, triage_queue và cảnh báo review, không tự gán P3. | T06 đạt; incident vẫn reported khi cần review. |
| W5 · 09/11/2026–15/11/2026 | Tính deadline nhận theo P1/P2/P3 bằng UTC và clock tiêm vào. | Test trước/đúng/sau hạn ổn định, không dùng đồng hồ thật. |
| W6 · 16/11/2026–22/11/2026 | Làm đổi priority có reason và tính lại deadline theo reported_at khi chưa nhận. | Deadline/history nhất quán, escalation cũ không bị xóa. |
| W7 · 23/11/2026–29/11/2026 | Làm escalation atomic, chống trùng và race với acknowledgment; xuất cổng SLA check cho N5. | T10–T12 đạt; mỗi incident/level chỉ có một escalation. |
| W8 · 30/11/2026–06/12/2026 | Ghép rule result vào create/triage và trạng thái nhận thật, giữ unit test độc lập. | Ba loại MVP phân đúng bộ phận; n8n tắt vẫn đọc được trạng thái. |
| W9 · 07/12/2026–13/12/2026 | Kiểm tra triage thủ công, rule version cũ và chuyển bộ phận khi rule thay đổi. | Không thay kết quả cũ âm thầm; lịch sử phân loại truy vết được. |
| W10 · 14/12/2026–20/12/2026 | Chạy test race SLA/job lặp/đổi priority/nhận đồng thời và sửa edge case. | Không gửi escalation trùng; deadline đúng UTC. |
| W11 · 21/12/2026–27/12/2026 | Viết hướng dẫn rule demo-v1, triage thủ công, đọc deadline và xử lý cảnh báo. | Người khác giải thích được T01–T06, T10–T12 từ bản chạy thật. |
| W12 · 28/12/2026–03/01/2027 | Regression rule/triage/SLA và đóng băng cấu hình trước 04/01. | Fixture expected và DB thật cùng kết quả; không lỗi chặn demo. |

### N4 — Phân công & vòng đời xử lý

| Tuần / ngày | Việc của mảng | Hoàn thành khi |
| --- | --- | --- |
| W1 · 12/10/2026–18/10/2026 | Định nghĩa state machine, ma trận thao tác và fixture assignment/comment/version từ contract. | Có bảng transition, request/response mẫu và test case sai trạng thái. |
| W2 · 19/10/2026–25/10/2026 | Viết migration assignment/comment/status history/audit và repository riêng. | FK/index/visibility đúng; migration sạch không sửa revision cũ. |
| W3 · 26/10/2026–01/11/2026 | Làm comment public/internal và serializer lọc visibility theo Principal giả. | Reporter không thấy internal dù gọi trực tiếp; nội dung được escape. |
| W4 · 02/11/2026–08/11/2026 | Làm phân công/chuyển bộ phận với handler hợp lệ, reason và version check. | Sai bộ phận/role/version bị chặn; history giữ đầy đủ. |
| W5 · 09/11/2026–15/11/2026 | Làm acknowledge một lần và transition assigned → in_progress. | Timestamp không bị ghi lại; người ngoài assignment không thao tác được. |
| W6 · 16/11/2026–22/11/2026 | Làm resolution, đóng, trả lại xử lý, reopen và duplicate/invalid. | Không nhảy trạng thái; reason/resolution bắt buộc đúng bước. |
| W7 · 23/11/2026–29/11/2026 | Chuẩn hóa audit/history và concurrent update trên mọi lệnh thay đổi. | Hai lệnh cùng version: đúng một thành công, một 409. |
| W8 · 30/11/2026–06/12/2026 | Ghép Principal N1, incident N2 và rule/priority N3 vào API thật. | Toàn bộ transition chạy trên DB thật mà không đổi contract. |
| W9 · 07/12/2026–13/12/2026 | Kiểm tra chuyển handler/bộ phận khi có ghi chú nội bộ và file đính kèm. | Quyền mới/cũ đúng sau chuyển; timeline không rò dữ liệu. |
| W10 · 14/12/2026–20/12/2026 | Test vòng đời đầy đủ, sai trạng thái, race và rollback transaction. | T07–T09 và các ca transition âm tính đạt. |
| W11 · 21/12/2026–27/12/2026 | Viết sơ đồ trạng thái và hướng dẫn phân công, xử lý, mở lại, audit. | Người khác thao tác được theo runbook và giải thích được lịch sử. |
| W12 · 28/12/2026–03/01/2027 | Regression phân công/comment/vòng đời; đóng băng endpoint trước 04/01. | Luồng từ assigned đến closed/reopen đạt trên DB thật. |

### N5 — n8n, outbox & thông báo

| Tuần / ngày | Việc của mảng | Hoàn thành khi |
| --- | --- | --- |
| W1 · 12/10/2026–18/10/2026 | Định nghĩa event envelope, signature và fixture incident.reported/assigned/priority/escalation từ contract. | Có mẫu hợp lệ/sai/trùng; backend khác có cổng phát event ổn định. |
| W2 · 19/10/2026–25/10/2026 | Viết migration outbox/notification, claim lease và worker stub; tạo workflow n8n giả lập. | Event claim/retry trên DB sạch; n8n demo nhận payload giả. |
| W3 · 26/10/2026–01/11/2026 | Làm service bearer /internal/* và HMAC timestamp/event ID ngoài Git. | User token không gọi internal; signature sai/quá hạn bị từ chối. |
| W4 · 02/11/2026–08/11/2026 | Làm dispatcher outbox với lease, attempt/backoff và phục hồi sau restart. | n8n down không mất event; restart không nhân đôi nghiệp vụ. |
| W5 · 09/11/2026–15/11/2026 | Làm workflow webhook kiểm signature/trùng và gọi API internal evaluate. | Event giả/trùng/quá hạn được xử lý đúng; có run ID. |
| W6 · 16/11/2026–22/11/2026 | Làm notification claim và email thử nghiệm cho báo cáo/phân công/P1. | Gửi đúng người/link; không gửi file, secret hoặc ghi chú internal. |
| W7 · 23/11/2026–29/11/2026 | Làm dead-letter/retry admin có reason và trạng thái sent/failed/uncertain. | Lỗi giữa chừng truy vết được; uncertain không tự gửi lại. |
| W8 · 30/11/2026–06/12/2026 | Ghép event thật từ N2/N3/N4, workflow evaluate và schedule SLA check. | Ba ca MVP đi xuyên backend→n8n→backend; SLA báo một lần/mức. |
| W9 · 07/12/2026–13/12/2026 | Làm email cập nhật public state, khóa chống trùng và giới hạn nội dung. | Người báo chỉ nhận update public; retry không tạo thư lặp ngoài chính sách. |
| W10 · 14/12/2026–20/12/2026 | Test n8n/email/API down, event trùng, restart, clock lệch và retry. | T13–T15 đạt; incident không mất và assignment không nhân đôi. |
| W11 · 21/12/2026–27/12/2026 | Viết runbook import workflow, credentials riêng, kiểm hàng chờ lỗi và phục hồi. | Người khác dựng n8n sạch, test email giả và xử lý event lỗi. |
| W12 · 28/12/2026–03/01/2027 | Regression automation/email/SLA job, xuất workflow và kiểm tra secrets mẫu. | T13–T15 xanh; bản bàn giao không chứa credentials thật. |

### N6 — Giao diện người báo

| Tuần / ngày | Việc của mảng | Hoàn thành khi |
| --- | --- | --- |
| W1 · 12/10/2026–18/10/2026 | Vẽ luồng reporter, ba form và trạng thái loading/empty/error/401/409; tạo mock API từ contract. | Wireframe và mock response đủ cho frontend chạy khi backend chưa có. |
| W2 · 19/10/2026–25/10/2026 | Làm layout responsive, routing reporter, API client và giữ bearer token trong memory. | Login/logout mock chạy; không lưu token vào storage/log. |
| W3 · 26/10/2026–01/11/2026 | Làm form rò nước, validation và hướng dẫn khẩn cấp khi gần điện. | Payload khớp contract; lỗi từng field và unknown hiển thị đúng. |
| W4 · 02/11/2026–08/11/2026 | Làm form nguy hiểm điện, cảnh báo an toàn và validation. | Dây hở/khói/tia lửa được gửi đúng; không giả định đã có cứu hộ. |
| W5 · 09/11/2026–15/11/2026 | Làm form phishing, kênh nhận/mức tương tác, chặn nhập password/OTP. | Không gửi/lưu secret; ba trạng thái tương tác phân biệt rõ. |
| W6 · 16/11/2026–22/11/2026 | Làm submit chống gửi lặp, tạo incident rồi upload từng file, hiển thị lỗi riêng. | Incident thành công nhưng file lỗi được báo đúng, không nói thành công toàn bộ. |
| W7 · 23/11/2026–29/11/2026 | Làm danh sách, chi tiết, timeline public, bổ sung thông tin và file được phép. | Reporter chỉ thấy dữ liệu của mình, UI có empty/error/loading. |
| W8 · 30/11/2026–06/12/2026 | Thay mock bằng API N1/N2 qua adapter hiện có; xử lý 401/403/404/409. | Luồng reporter thật chạy; xung đột yêu cầu tải lại. |
| W9 · 07/12/2026–13/12/2026 | Rà mobile, bàn phím, label, focus và thông tin priority không chỉ bằng màu. | Kịch bản chính thao tác trên điện thoại/laptop bằng bàn phím. |
| W10 · 14/12/2026–20/12/2026 | Chạy E2E reporter tạo/xem/bổ sung/upload/lỗi phiên và file. | T16 phần reporter xanh; UI và DB cùng trạng thái. |
| W11 · 21/12/2026–27/12/2026 | Viết hướng dẫn thao tác reporter và chuẩn bị dữ liệu reset ba tình huống. | Demo reporter có đường chính/dự phòng và ảnh minh họa đúng bản chạy. |
| W12 · 28/12/2026–03/01/2027 | Regression reporter trên build/Compose cuối, sửa lỗi chặn demo và đóng băng UI. | Ba form, upload, xem tiến độ ổn định trước 04/01. |

### N7 — Giao diện nhân viên & quản lý

| Tuần / ngày | Việc của mảng | Hoàn thành khi |
| --- | --- | --- |
| W1 · 12/10/2026–18/10/2026 | Vẽ luồng handler/manager, hàng đợi/chi tiết/timeline; tạo mock API role, triage, 409 và SLA. | Wireframe và fixture staff chạy khi backend chưa có. |
| W2 · 19/10/2026–25/10/2026 | Làm layout staff, role navigation, bộ lọc và bảng danh sách từ mock. | Handler/manager thấy đúng menu, empty/loading/error rõ. |
| W3 · 26/10/2026–01/11/2026 | Làm hàng đợi với cursor, lọc status/category/priority/department/triage. | Bộ lọc và phân trang không mất vị trí khi xem chi tiết. |
| W4 · 02/11/2026–08/11/2026 | Làm chi tiết, timeline, file, public/internal note và trạng thái quyền. | Reporter view không lẫn staff view; note internal được đánh dấu rõ. |
| W5 · 09/11/2026–15/11/2026 | Làm UI triage, phân công/chuyển bộ phận, đổi priority kèm reason. | Form bắt reason; 409 tải lại và không mất dữ liệu nhập. |
| W6 · 16/11/2026–22/11/2026 | Làm UI acknowledge, resolution, đóng/mở lại, duplicate/invalid. | Không hiện hành động sai trạng thái; backend vẫn là nơi quyết định quyền. |
| W7 · 23/11/2026–29/11/2026 | Làm dashboard demo quá hạn/lỗi automation và chỉ số theo quyền. | Có trạng thái empty/error; số liệu đúng phạm vi role. |
| W8 · 30/11/2026–06/12/2026 | Thay mock bằng API N1/N3/N4/N5 qua adapter hiện có. | Triage→assign→ack→resolve→close chạy với DB thật. |
| W9 · 07/12/2026–13/12/2026 | Rà bàn phím/mobile, focus, nhãn priority và cập nhật sau lỗi 403/409. | Handler/manager thao tác được trên laptop và màn nhỏ. |
| W10 · 14/12/2026–20/12/2026 | Chạy E2E staff/manager từ hàng đợi đến đóng/mở lại, gồm lỗi quyền/automation. | T16 phần staff xanh; UI/DB/timeline cùng trạng thái. |
| W11 · 21/12/2026–27/12/2026 | Chuẩn bị demo staff, dữ liệu reset, câu hỏi kiến trúc và kịch bản dự phòng. | Demo trọn luồng cùng N6, số liệu/rubric khớp bản chạy. |
| W12 · 28/12/2026–03/01/2027 | Regression staff trên Compose cuối, sửa lỗi chặn demo và đóng băng UI. | Luồng staff/manager ổn định trước 04/01. |

## Mốc tích hợp

| Mốc | Nội dung kiểm tra chung |
| --- | --- |
| Hết W4 (08/11) | Chạy auth và create incident thật; N3–N5 tiếp tục test fixture, N6–N7 tiếp tục mock nếu endpoint chưa sẵn. |
| Hết W7 (29/11) | Ghép policy, incident, rule, vòng đời và event ở mức API; mỗi mảng giữ unit/integration test riêng. |
| W8–W9 (30/11–13/12) | Đổi UI mock sang API thật, n8n nhận event thật, chạy luồng đầu-cuối của ba loại MVP. |
| Hết W11 (27/12) | Dựng sạch bằng Compose, migration/seed/import workflow, backup/restore và E2E; chỉ còn sửa lỗi chặn demo. |
| W12 (28/12–03/01) | Regression T01–T18, lint/build/test, đối chiếu tài liệu với bản chạy thật, đóng băng mã nguồn và bàn giao. |

## Sau 03/01/2027

04/01–10/01: ôn kiến trúc, nghiệp vụ, bảo mật, DB, n8n và test; bảo vệ thử ít nhất hai buổi. 11/01–12/01: tập demo, hỏi đáp và phương án dự phòng. Không nhận thêm tính năng trong giai đoạn này.
