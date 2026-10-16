# Yêu cầu nghiệp vụ — Campus Incident Management

Tài liệu này mô tả luồng nghiệp vụ của bản demo. Các quy tắc và tên bộ phận dùng dữ liệu giả, không thay thế quy trình xử lý sự cố của USTH. Request/response chi tiết nằm trong [API contract](api-contract.md); ca nghiệm thu nằm trong [kế hoạch kiểm thử](test-plan.md).

## Phạm vi MVP

MVP gồm ba loại báo cáo do người dùng gửi: **rò nước, nguy hiểm điện, phishing**. Luồng bắt buộc: đăng nhập → tạo báo cáo → lưu incident và sự kiện xử lý → đánh giá theo rule có phiên bản → phân công → nhân viên tiếp nhận → xử lý/đóng hoặc mở lại → hiển thị lịch sử và gửi email thử nghiệm → theo dõi SLA tiếp nhận/escalation. Bản demo phải chạy được khi n8n tạm dừng: incident vẫn được lưu và sự kiện được xử lý lại.

MVP không tự phát hiện từ log, không dùng email/SMS thật của trường và không xử lý dữ liệu hay ảnh thật của người dùng. Các chức năng mở rộng cần kế hoạch riêng để không ảnh hưởng luồng demo và test MVP.

## Vai trò, bộ phận và đường đi của báo cáo

| Actor | Trách nhiệm trong demo | Phạm vi dữ liệu |
| --- | --- | --- |
| Reporter | Tạo báo cáo, xem/bổ sung thông tin và trao đổi công khai trên báo cáo của mình | Incident do mình tạo |
| Handler | Nhận việc, ghi cập nhật, resolution và ghi chú nội bộ | Incident được giao thuộc bộ phận |
| Department Manager | Theo dõi hàng đợi, phân công/đổi ưu tiên/đóng/mở lại có lý do | Incident của bộ phận mình |
| Administrator | Quản lý tài khoản, bộ phận, rules, cấu hình và xử lý mọi incident khi cần | Mọi incident, file và bộ phận; thao tác có audit |
| Service n8n | Gọi API nội bộ bằng service credential giới hạn quyền | Chỉ các hành động workflow được cấp, không đọc toàn bộ bằng chứng |

Bộ phận dùng trong demo: **Cơ sở vật chất**, **Điện và an toàn**, **IT/Security** và **Hàng đợi phân loại thủ công**. Rò nước chuyển Cơ sở vật chất; nếu gần điện thì thêm safety flag. Nguy hiểm điện chuyển Điện và an toàn, phishing chuyển IT/Security. Báo cáo chưa phân loại được vào triage queue, không tự gán handler.

## Form theo loại sự cố

Trường chung: loại sự cố, tiêu đề (5–120 ký tự), mô tả (20–2000 ký tự), tòa nhà/khu vực (bắt buộc), vị trí chi tiết (tùy chọn, tối đa 200 ký tự), thời điểm quan sát (tùy chọn, không được ở tương lai), ảnh/file bằng chứng (tùy chọn, giới hạn do chính sách upload của mảng N2). Reporter được lấy từ phiên đăng nhập; form không cho tự nhập ID người khác.

| Loại | Câu hỏi bắt buộc | Câu hỏi tùy chọn | Kiểm tra riêng |
| --- | --- | --- | --- |
| Rò nước | Mức rò: ít/nhiều/không rõ; gần nguồn điện: có/không/không rõ | Nguy cơ trơn trượt | “Không rõ” không tự hạ ưu tiên xuống P3 |
| Nguy hiểm điện | Có dây hở: có/không/không rõ; có khói/tia lửa: có/không/không rõ | Thiết bị liên quan | Nếu có dấu hiệu nguy hiểm tức thời, hiện hướng dẫn khẩn cấp đã xác nhận |
| Phishing | Đã tương tác: chưa/bấm link/nhập thông tin/không rõ; kênh nhận: email/tin nhắn/khác | Người gửi dưới dạng văn bản | Không yêu cầu mật khẩu, mã OTP hay nội dung bí mật; URL chỉ hiển thị dạng text an toàn |

Frontend kiểm tra để báo lỗi sớm; backend vẫn validate mọi request. Hiển thị input dưới dạng text an toàn. Upload chỉ nhận loại file và dung lượng trong [API contract](api-contract.md). Demo dùng ảnh và email giả.

## Phân loại và mức ưu tiên

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

## SLA tiếp nhận

SLA chạy **24/7 theo thời gian liên tục** cho bản demo. Mốc bắt đầu `reported_at` UTC, kết thúc `acknowledged_at` UTC; `assigned_at` không dừng đồng hồ. Ngưỡng minh họa, phải cấu hình được và không dùng như cam kết thật của trường:

| Priority | Hạn tiếp nhận demo | Kiểm tra job | Escalation mức 1 |
| --- | --- | --- | --- |
| P1 | 15 phút | Mỗi 1 phút | Manager của bộ phận chính |
| P2 | 2 giờ | Mỗi 5 phút | Manager của bộ phận chính |
| P3 | 8 giờ | Mỗi 5 phút | Manager của bộ phận chính |

Deadline = `reported_at + ngưỡng` theo priority có hiệu lực. Job chỉ escalates khi incident chưa được tiếp nhận và thời gian hiện tại **lớn hơn hoặc bằng** deadline. Escalation có khóa duy nhất `(incident_id, level)` để retry hoặc chạy đồng thời không tạo lặp; cập nhật/kiểm tra điều kiện trong giao dịch. Nếu priority thay đổi trước khi tiếp nhận, tính lại deadline từ `reported_at`, lưu history và lý do; không xóa escalation đã xảy ra. Đổi bộ phận không đặt lại đồng hồ. Resolved/Closed không còn đủ điều kiện. Mở lại không tự tạo SLA tiếp nhận mới; SLA giải quyết là mục mở rộng chưa xếp lịch. Sai số phát hiện tối đa bằng chu kỳ job cộng thời gian xử lý, không cam kết chính xác từng giây. Email chỉ dùng hộp thư thử nghiệm.

Incident `triage_required` chưa có priority chính thức phải xuất hiện trong hàng đợi review thủ công ngay khi lưu và có cảnh báo cho manager demo trong vòng 15 phút. Đây là mốc review riêng, không được trình bày như SLA P1 đã tính xong hoặc âm thầm áp P3.

## Trạng thái và quyền chuyển

| Từ → Đến | Ai được làm | Điều kiện |
| --- | --- | --- |
| Reported → Assigned | Workflow tin cậy, manager trong bộ phận hoặc administrator | Có bộ phận; lý do/rule version; chưa đóng |
| Assigned → In Progress | Handler được giao, manager trong bộ phận hoặc administrator | Ghi `acknowledged_at` một lần |
| In Progress → Resolved | Handler được giao, manager trong bộ phận hoặc administrator | Bắt buộc resolution không rỗng |
| Resolved → Closed | Manager trong bộ phận hoặc administrator | Xác nhận kết quả và thời gian đóng |
| Resolved → In Progress | Manager trong bộ phận hoặc administrator | Lý do trả lại |
| Closed → In Progress | Manager trong bộ phận hoặc administrator | Lý do mở lại, giữ lịch sử cũ |

Không cho nhảy trạng thái ngoài bảng. Đổi handler/bộ phận là hành động riêng có reason/audit; không tự đánh dấu đã tiếp nhận. Báo trùng/không hợp lệ không tự xóa: manager đánh dấu disposition `Duplicate` hoặc `Invalid` với lý do và liên kết incident gốc nếu trùng; hành động này đóng báo cáo bằng luồng được ghi history. Nếu báo cáo thiếu thông tin nhưng hợp lệ, giữ Reported/triage; reporter có thể bổ sung. Mọi chuyển trạng thái dùng optimistic concurrency hoặc điều kiện phiên bản bản ghi để chặn ghi đè âm thầm.

## Quyền truy cập incident và file

| Hành động | Reporter | Handler | Manager | Administrator | Service n8n |
| --- | --- | --- | --- | --- | --- |
| Tạo báo cáo | Có, cho mình | Có, cho mình nếu cần | Có, cho mình nếu cần | Có, cho mình | Không |
| Xem incident | Của mình | Được giao | Của bộ phận | Mọi incident | Chỉ metadata cần workflow |
| Bổ sung thông tin / comment công khai | Của mình | Được giao | Của bộ phận | Mọi incident | Không |
| Ghi chú nội bộ | Không | Được giao | Của bộ phận | Mọi incident | Không |
| Tải file | File của incident mình được xem | Incident được giao | Incident của bộ phận | Mọi incident | Không mặc định |
| Phân công / đổi priority | Không | Không | Của bộ phận, có lý do | Mọi incident, có lý do | Chỉ endpoint quy định, có event ID |
| Nhận / xử lý | Không | Được giao | Của bộ phận | Mọi incident | Không |
| Đóng / mở lại | Không | Không | Của bộ phận, có lý do | Mọi incident, có lý do | Không |
| Quản lý user/department/rule | Không | Không | Không | Có, có audit | Không |

Backend kiểm tra role **và** phạm vi bản ghi ở mọi API; administrator là ngoại lệ phạm vi bộ phận/chủ sở hữu nhưng vẫn cần phiên hợp lệ, validation, version, lý do và audit. Ẩn nút UI không đủ; vai trò khác mặc định bị từ chối ngoài phạm vi. Comment/file có visibility public/internal, nhưng “public” chỉ có nghĩa hiển thị cho người liên quan có quyền, không phải URL công khai. Email không chứa bằng chứng, ghi chú nội bộ, token hoặc mật khẩu.

## Cảnh báo khẩn cấp và dữ liệu nhạy cảm

Thông điệp trên form nguy hiểm điện/rò nước gần điện: **“Nếu đang có nguy hiểm tức thời, hãy rời khỏi khu vực và liên hệ đầu mối khẩn cấp của trường theo hướng dẫn chính thức. Gửi báo cáo trong ứng dụng không thay thế cuộc gọi ứng cứu.”** Chỉ hiển thị số điện thoại hoặc tên người trực khi có thông tin chính thức từ trường. Phishing: **“Không nhập mật khẩu, mã OTP hoặc dữ liệu bí mật vào báo cáo; nếu đã nhập thông tin trên trang nghi giả mạo, hãy liên hệ IT/Security qua kênh chính thức.”** Không hứa thời gian phản hồi hoặc nói người trực đã nhận khi incident mới ở `reported`.

## Dữ liệu demo và lưu trữ

Dùng tài khoản và incident giả để kiểm tra phân quyền, phân loại, SLA và phân trang. Seed có thể chạy lại mà không nhân đôi dữ liệu. Bộ ca T01–T18 và cách ghi kết quả nằm trong [kế hoạch kiểm thử](test-plan.md).

Chỉ dùng dữ liệu tổng hợp hoặc giả lập trong repository và bản demo. Không commit file đính kèm thật, mật khẩu, service credentials, token hoặc export n8n chứa secrets. File lưu ở vùng không public, tên nội bộ không dựa trên tên người dùng; tải qua backend sau khi kiểm tra quyền. Log che nội dung nhạy cảm, chỉ giữ ID và trạng thái đủ để truy vết. Người có quyền xem bằng chứng theo ma trận quyền ở trên.

Sau buổi demo, xóa dữ liệu giả và các bản sao không cần giữ. Muốn dùng dữ liệu thật cần quy trình của trường về quyền truy cập, thời hạn lưu, yêu cầu xóa và backup/restore.
