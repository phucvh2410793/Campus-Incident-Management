# Bảo mật trong giai đoạn phát triển

Đây là khung phát triển nội bộ, chưa có cơ chế đăng nhập/phân quyền hoàn chỉnh và chưa sẵn sàng phục vụ người dùng thật.

- Compose chỉ bind cổng vào `127.0.0.1`. Không dùng cấu hình hiện tại để public lên Internet.
- `N8N_SECURE_COOKIE=false` chỉ dành cho localhost HTTP; triển khai public cần HTTPS và secure cookie.
- n8n dùng volume riêng để giữ workflow, credentials và database SQLite nội bộ; không dùng database nghiệp vụ làm nơi n8n ghi trực tiếp.
- Giữ `.env` và encryption key của n8n ngoài Git; backup key cùng kế hoạch backup dữ liệu, không đổi key tùy tiện khi đã có credentials.
- Trước khi mở endpoint incident, phải có xác thực, phân quyền bản ghi/file, validation, audit và kiểm thử vượt quyền.
- Chỉ sử dụng dữ liệu giả trong demo. Không yêu cầu người dùng nhập mật khẩu đã bị lộ vào báo cáo.

Nếu phát hiện vấn đề, báo trực tiếp cho trưởng nhóm qua kênh nội bộ đã thống nhất. Không đưa token, bằng chứng nhạy cảm hoặc hướng dẫn khai thác hệ thống đang dùng vào issue công khai. Chưa có địa chỉ liên hệ bảo mật chính thức hoặc cam kết thời gian phản hồi.
