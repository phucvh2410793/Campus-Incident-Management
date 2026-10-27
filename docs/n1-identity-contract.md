# N1 — Identity và phân quyền

## Mô hình dữ liệu

```mermaid
erDiagram
    departments o|--o{ users : "department_id (nullable)"
    users ||--o{ user_sessions : "user_id"
    departments {
        uuid id PK
        string name UK
        datetime created_at
    }
    users {
        uuid id PK
        string email UK
        string display_name
        string password_hash
        string role
        uuid department_id FK
        bool is_active
        datetime created_at
    }
    user_sessions {
        uuid id PK
        uuid user_id FK
        string token_hash UK
        datetime expires_at
        datetime created_at
        datetime revoked_at
    }
```

Migration `0001_identity` tạo `users` và `departments`; `154cfddf3634` thêm `user_sessions`. Mỗi user có một role và tối đa một department. Reporter và administrator có thể không thuộc department. Session chỉ lưu hash của token.

## Đăng nhập W3

`POST /api/v1/auth/login` kiểm tra mật khẩu bằng hash Argon2 đã lưu. Email không tồn tại, mật khẩu sai và tài khoản bị khóa đều trả cùng lỗi `401 invalid_credentials`; không tạo session. Với mỗi cặp email (viết thường)/IP kết nối trực tiếp, năm lần sai đầu trong 15 phút trả 401; các lần thử tiếp theo trả `429 rate_limited` cùng `Retry-After`. Đăng nhập đúng trước khi bị chặn sẽ xóa số lần sai của cặp đó. Backend trả `X-Request-ID` và lỗi theo dạng chung trong [API contract](api-contract.md).

API vẫn kiểm tra cú pháp email nhưng cho phép địa chỉ demo `@demo.invalid` do seed W2 sử dụng; domain này thường bị bộ kiểm tra email chặn theo mặc định.

Bộ đếm W3 nằm trong bộ nhớ của một process FastAPI để phục vụ bản demo Compose. Khởi động lại backend sẽ xóa bộ đếm; khi triển khai nhiều worker/instance cần chuyển sang kho dùng chung. Backend lấy IP từ kết nối trực tiếp, không tin header `X-Forwarded-For` do client tự gửi.

## Principal và Policy

`Principal` và `RolePolicy` nằm trong `backend/app/auth/policy.py`. Role hoặc action lạ bị từ chối. `RolePolicy` chỉ kiểm tra role; API incident/file còn phải kiểm tra owner, department và assignment của từng bản ghi.

| Action trong RolePolicy | Reporter | Handler | Department manager | Administrator |
| --- | --- | --- | --- | --- |
| `report_incident` | Có, cho mình | Có, cho mình | Có, cho mình | Có, tạo cho mình |
| `view_assigned_incidents` | Không | Có, nếu được giao | Có, nếu thuộc bộ phận | Có, mọi incident |
| `manage_department` | Không | Không | Không | Có |
| `manage_users`, `manage_roles` | Không | Không | Không | Có |

Quyền theo từng thao tác nằm trong [API contract](api-contract.md#quyền-theo-hành-động). [principals.json](fixtures/principals.json) có ID mẫu cho bốn role, bốn department và manager của `triage_queue`. File này dùng cho test/mock, không chứa mật khẩu hoặc token. Kiểm tra quyền theo từng incident được triển khai cùng các endpoint nghiệp vụ ở W5.
