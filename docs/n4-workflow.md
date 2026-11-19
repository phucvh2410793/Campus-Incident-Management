# N4 — Workflow contract

Dùng [API contract](api-contract.md) cho request/response. Các path bên dưới có prefix `/api/v1`.

## Thao tác và quyền

| Thao tác | Trạng thái | Quyền | Dữ liệu / kết quả |
| --- | --- | --- | --- |
| `assign` | `reported → assigned`; phân công lại giữ status | Manager bộ phận hiện tại hoặc administrator | `department_id`, `handler_id` hoặc null, `reason`; handler thuộc bộ phận đích |
| `acknowledge` | `assigned → in_progress` | Handler được giao, manager cùng bộ phận hoặc administrator | Ghi `acknowledged_at` một lần |
| `transitions` | `in_progress → resolved` | Handler được giao, manager cùng bộ phận hoặc administrator | `resolution` không rỗng |
| `transitions` | `resolved → closed` | Manager cùng bộ phận hoặc administrator | `reason` xác nhận hoặc null |
| `transitions` | `resolved → in_progress` | Manager cùng bộ phận hoặc administrator | `reason` bắt buộc |
| `transitions` | `closed → in_progress` | Manager cùng bộ phận hoặc administrator | `reason` bắt buộc; giữ timestamp/history cũ |
| `disposition` | Chưa `closed` → `closed` | Manager cùng bộ phận hoặc administrator | `duplicate`/`invalid`, `reason`; duplicate cần incident gốc |
| Comment `public` | Incident trong phạm vi xem | Reporter sở hữu, handler được giao, manager bộ phận hoặc administrator | `body` 1–2000 ký tự |
| Comment `internal` | Incident trong phạm vi xem | Handler được giao, manager bộ phận hoặc administrator | Reporter không được đọc/tạo; không gửi trong email |

Mọi lệnh ghi cần `expected_version` nguyên dương. Ngoài phạm vi xem trả 404;
thiếu quyền thao tác trả 403; sai transition hoặc version cũ trả 409; body sai trả
422. Administrator thao tác trên mọi incident nhưng vẫn chịu các kiểm tra
version, trạng thái và audit. Service dùng API nội bộ. UI hiển thị comment như
text, không render HTML người nhập.

## Code và fixture

- `backend/app/workflow/contracts.py`: schema request và kiểm tra các cạnh
  `/transitions` độc lập. Hàm nhận incident đã qua kiểm tra phạm vi của N1.
- `backend/app/comments/contracts.py`: schema comment. API đọc sẽ lọc theo visibility.
- `backend/tests/fixtures/n4_workflow.json`: dữ liệu giả và request/response mẫu
  cho N1/N2/N7 tham khảo. Principal/Incident chỉ là fixture, không thay model N1/N2.
- `backend/tests/test_workflow_contracts.py`: test 25 cặp trạng thái cho manager
  và administrator, quyền handler, text bắt buộc, version và field lạ.
- `backend/app/workflow/models.py` và `backend/app/comments/models.py`: bảng
  assignment, comment, status history và audit. `actor_id` có thể trống với
  thao tác tự động; comment luôn có người tạo.
- `backend/app/workflow/repository.py` và `backend/app/comments/repository.py`:
  ghi bản ghi, đọc theo incident; comment/history mặc định chỉ trả mục `public`.
- `backend/migrations/versions/n4_w2_workflow.py`: migration N4 nối tiếp
  `0002_n3_rule_sla`, có FK/index và chạy trong cùng chuỗi Alembic.
- `backend/tests/test_workflow_storage.py`: kiểm tra schema, repository,
  visibility, FK, rollback và Alembic head.

`validate_transition()` kiểm tra cạnh và role trên dữ liệu đã qua kiểm tra phạm vi.
Repository chưa thực hiện command nghiệp vụ; ở các tuần sau, service phải kiểm tra
`expected_version` và ghi incident/history/audit/outbox trong cùng transaction.

## Khi tích hợp

N1 cung cấp Principal/Policy, N2 cung cấp incident/version, N3 xử lý SLA,
N5 nhận event, N7 dùng request mẫu cho UI. Migration N4 đã nối sau các
migration W2 của N2/N3/N5; không sửa các revision của mảng khác.

Mỗi command phải ghi incident, history/audit và event cần thiết trong một
transaction; thất bại không được ghi nửa chừng. Hai command cùng version: đúng
một thành công, một 409. Assign không reset acknowledged_at hoặc đồng hồ SLA;
reopen không tạo SLA tiếp nhận mới.

Trước khi làm API phân công lại, bổ sung vào [API contract](api-contract.md)
trạng thái được phép assign lại, đặc biệt `resolved` và `closed`, rồi viết test
cho từng trường hợp.

## W4 assignment

Code: `backend/app/workflow/service.py`, `schemas.py`, `router.py`.
Endpoint: `POST /api/v1/incidents/{incident_id}/assign`.
Request: `department_id`, `handler_id` (UUID or null), nonempty `reason`,
`expected_version`. Manager must own the current department; administrator
can assign globally. Visible but unauthorized callers get 403, out-of-scope
or missing incidents get the same 404. Input errors are 422; stale versions
and invalid state transitions are 409. Responses include X-Request-ID.

State rules and assignment history IDs are specified in the W4 review section
of the API contract. Reassignment records a new Assignment and AuditLog but
never invents a same-state StatusHistory. The endpoint commits once; service
callers own their transaction. Assignment, incident/version, status history
when applicable, audit and outbox are atomic. No acknowledgment is performed.

Run `python -m pytest tests/test_assignment.py -q` from backend with project
dependencies installed. SQLite service/API tests cover scope, validation,
state/version handling, rollback and outbox contents. Shared row locks and
simultaneous races still require PostgreSQL runtime verification; the SQLite
checks do not prove PostgreSQL concurrency behavior.


## W5 acknowledgment

Endpoint: `POST /api/v1/incidents/{incident_id}/acknowledge` with only
`expected_version` (a positive integer). The assigned handler, current department
manager or administrator can receive an incident. Other visible callers get 403;
out-of-scope and missing incidents get 404. Authentication still uses N1 bearer sessions.

Only `assigned -> in_progress` is allowed. The command increments version once and
sets `acknowledged_at` in UTC. The SQL UPDATE checks version, status and current
assignment; COALESCE preserves any previously recorded acknowledgment timestamp.
Repeating an old version returns 409 version_conflict; repeating with the current
version when no longer assigned returns 409 invalid_transition. Neither writes again.

Incident update, public StatusHistory and AuditLog are atomic. The service uses a
savepoint and leaves commit to the caller; the HTTP route commits once and rolls back
on failure. The response reuses the existing `{incident, history_id}` command envelope;
for acknowledgment, history_id references status_history. No new assignment is made,
no deadline is reset, and no unsupported acknowledgment outbox event is invented.
N3 SLA eligibility stops based on acknowledged_at; the deadline remains historical data.

Code: AcknowledgmentService in backend/app/workflow/service.py and the existing workflow
router. No migration is required. Tests: `python -m pytest tests/test_acknowledgment.py -q`
from backend with project dependencies installed. SQLite tests cover service/API behavior,
UTC clocks, repeated calls, conditional updates and rollback. Real PostgreSQL parallel
requests and race with the SLA job require later integration verification (N3/N4 W7).
