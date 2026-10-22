# N3 — Fixture phân loại và SLA

[n3_cases.json](fixtures/n3_cases.json) chứa input và expected result của T01–T06, T10–T12. Fixture dùng `schema_version=1` và rule `demo-v1`. N2, N4, N7 có thể dùng cùng file trong test/mock mà không cần chạy rule engine.

`classification_cases[].request` dùng `category` và `answers` trong [API contract](api-contract.md); `expected` là `RuleResult`. `severity` và `priority` viết thường (`low`…`critical`, `p1`…`p3`). `department` là tên bộ phận; trước khi ghi DB cần tra `department_id` tương ứng. T06 có câu trả lời `unknown`, được đưa vào `triage_queue` và chưa có priority.

Các mốc SLA dùng ISO 8601 UTC. So sánh `deadline_at` với `calculate_deadline`; `job_at` là lúc job kiểm tra. T12 mô tả hai thứ tự commit: acknowledge trước thì không escalation, job trước thì tối đa một escalation. Test transaction và job thật nằm ở W10.

## Dữ liệu W2

Migration `n3w2_merge_n2_n5` nối hai nhánh N2 và N5. Migration `0002_n3_rule_sla` tạo bảng `rule_versions`, `rule_evaluations`, `escalations` và nạp `demo-v1` với chín rule R01–R09. Rule R03 có cờ `near_electricity` giống fixture. Version của rule và cặp `(incident_id, level)` của escalation là duy nhất; level dùng số nguyên như `incidents.escalation_level`.

Khi ghép PR, đưa N2 vào `main` trước N3 để PR N3 chỉ còn phần rule/SLA và migration nối nhánh. Sau khi ghép, chạy `alembic upgrade head` và `alembic check`. Migration workflow của N4 có thể nối sau head N3.
