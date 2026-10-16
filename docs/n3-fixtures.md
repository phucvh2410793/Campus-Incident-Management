# N3 W1 — fixture phân loại và SLA

[n3_cases.json](fixtures/n3_cases.json) là dữ liệu mẫu độc lập với code cho T01–T06 và T10–T12. `schema_version=1` cố định cấu trúc fixture; `rule_version=demo-v1` cố định phiên bản rule. N2, N4 và N7 có thể nạp cùng file JSON khi viết test/mock mà không cần chạy engine N3.

Mỗi `classification_cases[].request` dùng đúng `category` và `answers` của [API contract](api-contract.md); `expected` chứa toàn bộ `RuleResult`. `severity` và `priority` dùng enum chữ thường trên dây (`low`…`critical`, `p1`…`p3`). `department` là **tên bộ phận demo**, không phải `department_id`: khi ghi incident hoặc trả API, tầng tích hợp phải tra ID của department tương ứng; hàng đợi thủ công phải tra ID `triage_queue`. T06 là báo cáo hợp lệ với câu trả lời `unknown`, cần phân loại thủ công và không có priority.

Các ca SLA dùng thời gian ISO 8601 UTC. `deadline_at` là kỳ vọng độc lập để đối chiếu với `calculate_deadline`; `job_at` là lúc quét và `acknowledged_at` là dữ liệu tại lúc đó. T12 ghi hai thứ tự commit: acknowledge thắng thì không có escalation; job thắng thì tối đa một escalation hợp lệ. Fixture và unit test chỉ chốt kết quả mong đợi; kiểm chứng race bằng DB transaction/job thật thuộc W10.
