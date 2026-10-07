# Phần A — Yêu cầu và nghiệp vụ Campus Incident Management

Tài liệu này ghi phân tích và đề xuất quyết định nghiệp vụ A01–A12 cho [kế hoạch công việc còn lại](KE_HOACH_CONG_VIEC.md). Các quy tắc bên dưới là **quy ước cho bản demo của nhóm**, không phải quy trình ứng cứu chính thức của USTH. Phần cần xác nhận từ giảng viên hoặc trường được ghi rõ, không được suy đoán là đã phê duyệt.

## A01. Ràng buộc môn học cần xác nhận

Chưa có đề cương môn học, rubric, ngày nộp chính thức hoặc yêu cầu triển khai do giảng viên cung cấp trong repository. Trước khi chốt phạm vi, nhóm cần ghi câu trả lời vào bảng sau.

| Câu hỏi | Trạng thái hiện tại | Ảnh hưởng nếu khác giả định |
| --- | --- | --- |
| Ngày nộp, ngày bảo vệ và hình thức nộp | Chưa xác nhận; lịch nội bộ đặt hạn hoàn tất 03/01/2027 | Phải điều chỉnh lịch và sản phẩm bàn giao |
| Tiêu chí chấm và yêu cầu bắt buộc về công nghệ | Chưa xác nhận; proposal dự kiến React/TypeScript, FastAPI, PostgreSQL, n8n | Có thể phải đổi kiến trúc hoặc thứ tự ưu tiên |
| Quy định dùng dữ liệu thật, email thật hoặc hệ thống của trường | Chưa xác nhận; mặc định chỉ dùng dữ liệu giả | Không được tích hợp nguồn thật trước khi có quyền |
| Mức độ bắt buộc của các mục mở rộng | Chưa xác nhận; kế hoạch 7 mảng hiện chỉ xếp ba loại MVP | Nếu giảng viên yêu cầu, cần chốt lại phạm vi và lịch trước khi nhận thêm |

## A02. Phạm vi MVP và ngoài phạm vi

MVP gồm ba loại báo cáo do người dùng gửi: **rò nước, nguy hiểm điện, phishing**. Luồng bắt buộc: đăng nhập → tạo báo cáo → lưu incident và sự kiện xử lý → đánh giá theo rule có phiên bản → phân công → nhân viên tiếp nhận → xử lý/đóng hoặc mở lại → hiển thị lịch sử và gửi email thử nghiệm → theo dõi SLA tiếp nhận/escalation. Bản demo phải chạy được khi n8n tạm dừng: incident vẫn được lưu và sự kiện được xử lý lại.

MVP chưa tự phát hiện từ log, chưa tích hợp email/SMS thật của trường, chưa cam kết ứng cứu thời gian thực, chưa hỗ trợ dữ liệu nhạy cảm hoặc ảnh thực tế của người dùng. Các mở rộng chưa nằm trong lịch 7 mảng; nếu thuộc phạm vi nộp, nhóm phải chốt lại khối lượng và lịch trước 04/01/2027 mà không làm mất các ca kiểm thử MVP. Nội dung này là phạm vi đề xuất của nhóm, chờ giảng viên xác nhận theo A01.

## A03. Actor, bộ phận và đường đi của báo cáo

| Actor | Trách nhiệm trong demo | Phạm vi dữ liệu |
| --- | --- | --- |
| Reporter | Tạo báo cáo, xem/bổ sung thông tin và trao đổi công khai trên báo cáo của mình | Incident do mình tạo |
| Handler | Nhận việc, ghi cập nhật, resolution và ghi chú nội bộ | Incident được giao thuộc bộ phận |
| Department Manager | Theo dõi hàng đợi, phân công/đổi ưu tiên/đóng/mở lại có lý do | Incident của bộ phận mình |
| Administrator | Quản lý tài khoản, bộ phận, rules và cấu hình | Quyền đọc incident không mặc định; chỉ có khi được cấp rõ |
| Service n8n | Gọi API nội bộ bằng service credential giới hạn quyền | Chỉ các hành động workflow được cấp, không đọc toàn bộ bằng chứng |

Bộ phận demo: **Cơ sở vật chất**, **Điện và an toàn**, **IT/Security**, **Hàng đợi phân loại thủ công**. Đây là tên minh họa; bộ phận thật và người nhận escalation phải được trường xác nhận trước khi dùng thật. Rò nước thường chuyển Cơ sở vật chất; nếu gần điện, đồng thời gắn cờ an toàn để người phụ trách đánh giá. Nguy hiểm điện chuyển Điện và an toàn. Phishing chuyển IT/Security. Báo cáo hợp lệ nhưng chưa đủ điều kiện phân loại vào hàng đợi thủ công, không tự tạo người xử lý giả.

## A04. User story và điều kiện nghiệm thu

| Mã | User story | Thành công | Thất bại cần hiển thị/ghi nhận |
| --- | --- | --- | --- |
| US01 | Reporter đăng nhập và gửi một trong ba loại báo cáo | Nhận mã incident; dữ liệu và outbox lưu cùng giao dịch | Trường bắt buộc sai, file không hợp lệ hoặc gửi lặp bị chặn; không tạo bản ghi nửa chừng |
| US02 | Reporter xem danh sách/chi tiết và bổ sung thông tin | Chỉ thấy incident của mình, cập nhật hiển thị đúng | ID của người khác trả lỗi quyền, không lộ ghi chú nội bộ |
| US03 | Hệ thống đánh giá và phân công | Có severity, priority, bộ phận, lý do và rule version | Thiếu dữ liệu/không khớp rule vào hàng đợi thủ công; n8n lỗi vẫn giữ incident |
| US04 | Handler nhận và xử lý sự cố | `acknowledged_at` được ghi một lần; resolution bắt buộc trước Resolved | Người không được giao bị chặn; cập nhật đồng thời trả xung đột |
| US05 | Manager phân công lại, đổi ưu tiên, đóng/mở lại | Có lý do, audit, history và phạm vi bộ phận đúng | Transition sai hoặc khác bộ phận bị chặn |
| US06 | Người có quyền xem thông tin/ghi chú và file | Public/internal tách biệt; file tải qua kiểm tra quyền | Ghi chú nội bộ và file không lộ qua API, email hay URL công khai |
| US07 | Manager theo dõi SLA tiếp nhận | Quá hạn tạo đúng một escalation/mức | Đã tiếp nhận trước hạn hoặc race condition không tạo escalation sai |
| US08 | Operator xem lỗi workflow và retry | Có event/run ID, retry có giới hạn và truy vết được | Event trùng không nhân đôi assignment/history/email |

Các ca nghiệm thu cụ thể T01–T18 nằm trong [kế hoạch kiểm thử](test-plan.md); chúng là expected result độc lập để viết test.

## A05. Form theo loại sự cố

Trường chung: loại sự cố, tiêu đề (5–120 ký tự), mô tả (20–2000 ký tự), tòa nhà/khu vực (bắt buộc), vị trí chi tiết (tùy chọn, tối đa 200 ký tự), thời điểm quan sát (tùy chọn, không được ở tương lai), ảnh/file bằng chứng (tùy chọn, giới hạn do chính sách upload của mảng N2). Reporter được lấy từ phiên đăng nhập; form không cho tự nhập ID người khác.

| Loại | Câu hỏi bắt buộc | Câu hỏi tùy chọn | Kiểm tra riêng |
| --- | --- | --- | --- |
| Rò nước | Mức rò: ít/nhiều/không rõ; gần nguồn điện: có/không/không rõ | Có nguy cơ trơn trượt; mô tả nguồn nước | “Không rõ” không tự hạ ưu tiên xuống P3 |
| Nguy hiểm điện | Có dây hở: có/không/không rõ; có khói/tia lửa: có/không/không rõ | Thiết bị liên quan; đã tách khỏi khu vực chưa | Nếu có dấu hiệu nguy hiểm tức thời, hiện hướng dẫn khẩn cấp đã xác nhận |
| Phishing | Đã tương tác: chưa/bấm link/nhập thông tin/không rõ; kênh nhận: email/tin nhắn/khác | Tên miền/người gửi dưới dạng văn bản; thời điểm nhận | Không yêu cầu mật khẩu, mã OTP hay nội dung bí mật; URL chỉ hiển thị dạng text an toàn |

Frontend và backend cùng kiểm tra; backend là nguồn quyết định. Dữ liệu nhập được escape khi hiển thị. Không cho upload file thực thi; whitelist loại/tối đa dung lượng cần khóa ở N2-W07 trước khi mở chức năng. Ảnh hoặc email mẫu dùng cho demo phải là dữ liệu giả.

## A06. Severity, priority và quy tắc demo

Severity = tác động (`Low`, `Medium`, `High`, `Critical`); priority = thứ tự xử lý (`P1`, `P2`, `P3`). `P1` là cao nhất. Rule được đánh giá theo thứ tự trên xuống, **quy tắc đầu tiên khớp thắng**; lưu `rule_id`, `rule_version` và giải thích ngắn. Các dòng dưới là baseline demo phiên bản `demo-v1`, không phải chính sách trường.

| Thứ tự | Điều kiện | Severity | Priority | Bộ phận chính | Giải thích lưu |
| --- | --- | --- | --- | --- | --- |
| 1 | Nguy hiểm điện và có khói/tia lửa | Critical | P1 | Điện và an toàn | Dấu hiệu nguy hiểm tức thời |
| 2 | Phishing và đã nhập thông tin | High | P1 | IT/Security | Nguy cơ lộ thông tin |
| 3 | Rò nước và gần nguồn điện | High | P1 | Cơ sở vật chất | Nước gần điện cần ưu tiên cao; gắn cờ an toàn |
| 4 | Nguy hiểm điện và có dây hở | High | P1 | Điện và an toàn | Nguy cơ chạm điện |
| 5 | Phishing và đã bấm link, chưa nhập thông tin | Medium | P2 | IT/Security | Cần kiểm tra thiết bị/tài khoản |
| 6 | Rò nước nhiều, không gần điện | Medium | P2 | Cơ sở vật chất | Có nguy cơ lan rộng/trơn trượt |
| 7 | Rò nước ít, không gần điện | Low | P3 | Cơ sở vật chất | Chưa có dấu hiệu tăng cấp |
| 8 | Phishing, chưa tương tác | Low | P3 | IT/Security | Chưa ghi nhận tương tác |
| 9 | Nguy hiểm điện, không dây hở, không khói/tia lửa | Medium | P2 | Điện và an toàn | Cần kiểm tra tại chỗ |

Nếu câu trả lời là “không rõ”, tổ hợp mâu thuẫn hoặc không khớp: đặt `triage_required`, đưa vào hàng đợi thủ công, giữ trạng thái Reported và không tự gán priority thấp. Nếu cùng incident khớp nhiều rule, thứ tự trên ưu tiên dấu hiệu nguy hiểm. Manager được đổi priority chỉ khi có lý do; audit lưu trước/sau và rule evaluation gốc không bị ghi đè. Quy tắc phải có ca test cho thiếu dữ liệu và xung đột.

## A07. SLA tiếp nhận demo

SLA chạy **24/7 theo thời gian liên tục** cho bản demo. Mốc bắt đầu `reported_at` UTC, kết thúc `acknowledged_at` UTC; `assigned_at` không dừng đồng hồ. Ngưỡng minh họa, phải cấu hình được và không dùng như cam kết thật của trường:

| Priority | Hạn tiếp nhận demo | Kiểm tra job | Escalation mức 1 |
| --- | --- | --- | --- |
| P1 | 15 phút | Mỗi 1 phút | Manager của bộ phận chính |
| P2 | 2 giờ | Mỗi 5 phút | Manager của bộ phận chính |
| P3 | 8 giờ | Mỗi 5 phút | Manager của bộ phận chính |

Deadline = `reported_at + ngưỡng` theo priority có hiệu lực. Job chỉ escalates khi incident chưa được tiếp nhận và thời gian hiện tại **lớn hơn hoặc bằng** deadline. Escalation có khóa duy nhất `(incident_id, level)` để retry hoặc chạy đồng thời không tạo lặp; cập nhật/kiểm tra điều kiện trong giao dịch. Nếu priority thay đổi trước khi tiếp nhận, tính lại deadline từ `reported_at`, lưu history và lý do; không xóa escalation đã xảy ra. Đổi bộ phận không đặt lại đồng hồ. Resolved/Closed không còn đủ điều kiện. Mở lại không tự tạo SLA tiếp nhận mới; SLA giải quyết là mục mở rộng chưa xếp lịch. Sai số phát hiện tối đa bằng chu kỳ job cộng thời gian xử lý, không cam kết chính xác từng giây. Email chỉ dùng hộp thư thử nghiệm.

Incident `triage_required` chưa có priority chính thức phải xuất hiện trong hàng đợi review thủ công ngay khi lưu và có cảnh báo cho manager demo trong vòng 15 phút. Đây là mốc review riêng, không được trình bày như SLA P1 đã tính xong hoặc âm thầm áp P3.

## A08. Trạng thái và quyền chuyển

| Từ → Đến | Ai được làm | Điều kiện |
| --- | --- | --- |
| Reported → Assigned | Workflow tin cậy hoặc manager | Có bộ phận; lý do/rule version; chưa đóng |
| Assigned → In Progress | Handler được giao hoặc manager trong bộ phận | Ghi `acknowledged_at` một lần |
| In Progress → Resolved | Handler được giao hoặc manager trong bộ phận | Bắt buộc resolution không rỗng |
| Resolved → Closed | Manager trong bộ phận | Xác nhận kết quả và thời gian đóng |
| Resolved → In Progress | Manager trong bộ phận | Lý do trả lại |
| Closed → In Progress | Manager trong bộ phận | Lý do mở lại, giữ lịch sử cũ |

Không cho nhảy trạng thái ngoài bảng. Đổi handler/bộ phận là hành động riêng có reason/audit; không tự đánh dấu đã tiếp nhận. Báo trùng/không hợp lệ không tự xóa: manager đánh dấu disposition `Duplicate` hoặc `Invalid` với lý do và liên kết incident gốc nếu trùng; hành động này đóng báo cáo bằng luồng được ghi history. Nếu báo cáo thiếu thông tin nhưng hợp lệ, giữ Reported/triage; reporter có thể bổ sung. Mọi chuyển trạng thái dùng optimistic concurrency hoặc điều kiện phiên bản bản ghi để chặn ghi đè âm thầm.

## A09. Ma trận quyền bản ghi và file

| Hành động | Reporter | Handler | Manager | Administrator | Service n8n |
| --- | --- | --- | --- | --- | --- |
| Tạo báo cáo | Có, cho mình | Có, cho mình nếu cần | Có, cho mình nếu cần | Không mặc định | Không |
| Xem incident | Của mình | Được giao | Của bộ phận | Không mặc định | Chỉ metadata cần workflow |
| Bổ sung thông tin / comment công khai | Của mình | Được giao | Của bộ phận | Không mặc định | Không |
| Ghi chú nội bộ | Không | Được giao | Của bộ phận | Không mặc định | Không |
| Tải file | File của incident mình được xem | Incident được giao | Incident của bộ phận | Không mặc định | Không mặc định |
| Phân công / đổi priority | Không | Không | Của bộ phận, có lý do | Không mặc định | Chỉ endpoint quy định, có event ID |
| Nhận / xử lý | Không | Được giao | Của bộ phận | Không mặc định | Không |
| Đóng / mở lại | Không | Không | Của bộ phận, có lý do | Không mặc định | Không |
| Quản lý user/department/rule | Không | Không | Không | Có, có audit | Không |

Backend kiểm tra role **và** phạm vi bản ghi ở mọi API; ẩn nút UI không đủ. Mặc định từ chối. Comment/file có visibility public/internal, nhưng “public” chỉ có nghĩa hiển thị cho người liên quan có quyền, không phải URL công khai. Admin không tự động được xem bằng chứng; nếu cần truy cập hỗ trợ, phải có quyền riêng, mục đích và audit. Email không chứa bằng chứng, ghi chú nội bộ, token hoặc mật khẩu.

## A10. Cảnh báo khẩn cấp và dữ liệu nhạy cảm

Thông điệp trên form nguy hiểm điện/rò nước gần điện: **“Nếu đang có nguy hiểm tức thời, hãy rời khỏi khu vực và liên hệ đầu mối khẩn cấp của trường theo hướng dẫn chính thức. Gửi báo cáo trong ứng dụng không thay thế cuộc gọi ứng cứu.”** Chưa đưa số điện thoại hoặc tên người trực vào ứng dụng vì chưa có xác nhận từ trường. Phishing: **“Không nhập mật khẩu, mã OTP hoặc dữ liệu bí mật vào báo cáo; nếu đã nhập thông tin trên trang nghi giả mạo, hãy liên hệ IT/Security qua kênh chính thức.”** Không hiển thị thông điệp hứa thời gian phản hồi hoặc nói báo cáo đã được người trực nhận khi mới lưu Reported.

## A11. Dữ liệu demo và phép đo

Dùng account giả cho bốn vai trò, đủ hai bộ phận khác nhau để kiểm tra phân quyền; ít nhất 18 incident tương ứng T01–T18, có thêm khoảng 100 incident sinh tự động để thử phân trang/index. Dữ liệu cố định `reported_at`, priority và expected result cho ca SLA; không dùng email/số điện thoại/ảnh thật. Seed có thể chạy lại mà không nhân đôi dữ liệu.

Đo: tỉ lệ phân loại đúng trên T01–T06 = số ca đúng / 6; tỉ lệ chặn truy cập sai trên T07–T09 = số ca chặn đúng / 3; tỉ lệ xử lý đúng SLA/retry/downtime trên T10–T15 = số ca đúng / 6; T16–T18 báo đạt/không đạt riêng. Đo thời gian từ gửi đến incident được lưu, từ lưu đến phân công, latency danh sách/chi tiết với cỡ mẫu và môi trường ghi rõ. Nhóm cần khóa ngưỡng đạt trước khi N2 đo hiệu năng ở W9; không công bố số liệu giả là kết quả test.

## A12. Giữ/xóa dữ liệu và giới hạn sử dụng

Chỉ dùng dữ liệu tổng hợp hoặc giả lập trong repository và bản demo. Không commit file đính kèm thật, mật khẩu, service credentials, token hoặc export n8n chứa secrets. File lưu ở vùng không public, tên nội bộ không dựa trên tên người dùng; tải qua backend sau khi kiểm tra quyền. Log che nội dung nhạy cảm, chỉ giữ ID và trạng thái đủ để truy vết. Người có quyền xem bằng chứng theo A09.

Sau buổi demo, xóa dữ liệu giả trên môi trường demo và các bản sao không cần giữ; nếu cần lưu bằng chứng học thuật, chỉ giữ ảnh/chỉ số đã loại thông tin cá nhân. Chưa đặt thời hạn lưu giữ cho dữ liệu thật vì thiếu quy định của trường. Trước vận hành thật phải xác nhận: cơ sở pháp lý/quyền sử dụng dữ liệu, thời hạn lưu, quy trình yêu cầu xóa, sao lưu/khôi phục, đầu mối xử lý sự cố và quyền truy cập bằng chứng. Không triển khai production dựa trên chính sách demo này.

## Các quyết định còn cần xác nhận bên ngoài nhóm

1. Rubric, hạn nộp, bắt buộc công nghệ và phạm vi mở rộng ngoài ba loại MVP theo giảng viên (A01).
2. Tên bộ phận, đầu mối khẩn cấp và người nhận escalation thật của trường (A03, A07, A10).
3. Quy định dữ liệu thật, lưu giữ/xóa, email/log và phân quyền xem bằng chứng trước vận hành thực tế (A09, A12).

Các mục trên không cản trở triển khai **demo bằng dữ liệu giả** theo baseline này, nhưng phải được xác nhận trước khi tuyên bố hệ thống phù hợp quy trình thật.
