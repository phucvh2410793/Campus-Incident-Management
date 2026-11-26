# Campus Incident Management frontend

## Nguồn nghiệp vụ

Thiết kế dựa trên `README.md` và `docs/business-requirements.md` của repository Campus Incident Management: ba loại sự cố MVP (rò nước, nguy hiểm điện, phishing), hai không gian người báo cáo và nhân viên, cùng vòng đời tiếp nhận → phân công → xử lý → giải quyết → đóng.

## Thiết kế mới

- Sidebar cho các điểm đến chính, header ngắn và vùng nội dung tập trung vào công việc hiện tại.
- Người báo cáo: tổng quan báo cáo, tìm và lọc, chi tiết trong panel, biểu mẫu mới theo ba bước với câu hỏi theo loại sự cố và tải tệp.
- Nhân viên: tổng quan ưu tiên, hàng đợi có tìm và lọc, panel chi tiết với lịch sử, trao đổi và hành động theo quyền.
- Màu chủ đạo xanh biển `#075985`, nền trắng, font Inter tự lưu trong ứng dụng. Màu đỏ và cam chỉ dành cho trạng thái cần chú ý.
- Giao diện responsive tại 375px; panel chi tiết chiếm toàn màn trên điện thoại.

## Kết nối dữ liệu

Các màn mới ở `src/modern/` gọi `demoClient` và các mock API hiện có. Bản demo giữ đăng nhập trong bộ nhớ; tải lại trang sẽ quay về trạng thái chưa đăng nhập. Các màn W1–W7 cũ vẫn tồn tại trong source để không làm hỏng fixture và bài kiểm thử cũ, nhưng không còn nằm trong tuyến sử dụng chính.

