# N4 — Workflow contract

Use the [API contract](api-contract.md) for request/response. All paths below have the `/api/v1` prefix.

## Operations and permissions

| Operation | State | Permission | Data / result |
| --- | --- | --- | --- |
| `assign` | `reported → assigned`; reassignment keeps status | Current department manager or administrator | `department_id`, `handler_id` or null, `reason`; handler belongs to the target department |
| `acknowledge` | `assigned → in_progress` | Assigned handler, same-department manager or administrator | Records `acknowledged_at` once |
| `transitions` | `in_progress → resolved` | Assigned handler, same-department manager or administrator | Nonempty `resolution` |
| `transitions` | `resolved → closed` | Same-department manager or administrator | Confirmation `reason` or null |
| `transitions` | `resolved → in_progress` | Same-department manager or administrator | `reason` required |
| `transitions` | `closed → in_progress` | Same-department manager or administrator | `reason` required; keeps old timestamps/history |
| `disposition` | Not `closed` → `closed` | Same-department manager or administrator | `duplicate`/`invalid`, `reason`; duplicate needs the original incident |
| Comment `public` | Incident in view scope | Owner reporter, assigned handler, department manager or administrator | `body` 1–2000 characters |
| Comment `internal` | Incident in view scope | Assigned handler, department manager or administrator | Reporter cannot read or create; not sent in email |

Every write command needs a positive integer `expected_version`. Out of scope returns 404; insufficient permission returns 403; wrong transition or stale version returns 409; invalid body returns 422. Administrators can act on any incident but still pass version, state and audit checks. Services use the internal API. The UI renders comments as plain text, never as HTML entered by users.

## Code and fixtures

- `backend/app/workflow/contracts.py`: request schemas and standalone `/transitions` edge checks. Takes an incident already scope-checked by N1.
- `backend/app/comments/contracts.py`: comment schemas. Read APIs filter by visibility.
- `backend/tests/fixtures/n4_workflow.json`: sample data and request/response examples for N1/N2/N7. Principal/Incident are fixtures only, not N1/N2 models.
- `backend/tests/test_workflow_contracts.py`: 25 state-pair tests for manager and administrator, handler permissions, required text, versions and unknown fields.
- `backend/app/workflow/models.py` and `backend/app/comments/models.py`: assignment, comment, status history and audit tables. `actor_id` may be empty for automated actions; comments always have an author.
- `backend/app/workflow/repository.py` and `backend/app/comments/repository.py`: write records and read by incident; comment/history reads default to `public` items only.
- `backend/migrations/versions/n4_w2_workflow.py`: N4 migration after `0002_n3_rule_sla`, with FK/indexes, in the same Alembic chain.
- `backend/tests/test_workflow_storage.py`: schema, repository, visibility, FK, rollback and Alembic head checks.

`validate_transition()` checks edges and roles on scope-checked data. Every command must check `expected_version` and write incident/history/audit/outbox in one transaction.

## Integration

N1 provides Principal/Policy, N2 provides incident/version, N3 handles SLA, N5 receives events, N7 uses the sample requests for the UI. The N4 migration follows the W2 migrations of N2/N3/N5; never edit another area's revisions.

Every command writes the incident, history/audit and required events in one transaction; a failure must not write anything halfway. Two commands with the same version: exactly one succeeds, one gets 409. Assign does not reset `acknowledged_at` or the SLA clock; reopen does not create a new acknowledgment SLA.

Before building reassignment, add the allowed assign states to the [API contract](api-contract.md) — especially `resolved` and `closed` — and write a test for each case.

## W4 assignment

Code: `backend/app/workflow/service.py`, `schemas.py`, `router.py`. Endpoint: `POST /api/v1/incidents/{incident_id}/assign`. Request: `department_id`, `handler_id` (UUID or null), nonempty `reason`, `expected_version`. The manager must own the current department; administrators can assign globally. Visible but unauthorized callers get 403; out-of-scope or missing incidents get 404. Input errors are 422; stale versions and invalid state transitions are 409. Responses include X-Request-ID.

State rules and assignment history IDs are in the W4 review section of the API contract. Reassignment records a new Assignment and AuditLog but never invents a same-state StatusHistory. The endpoint commits once; service callers own their transaction. Assignment, incident/version, status history when applicable, audit and outbox are atomic. No acknowledgment is performed.

Run `python -m pytest tests/test_assignment.py -q` from backend with project dependencies installed. SQLite service/API tests cover scope, validation, state/version handling, rollback and outbox contents. Shared row locks and simultaneous races are verified on real PostgreSQL in W7 below; the SQLite checks do not prove PostgreSQL concurrency behavior.

## W5 acknowledgment

Endpoint: `POST /api/v1/incidents/{incident_id}/acknowledge` with only `expected_version` (a positive integer). The assigned handler, current department manager or administrator can acknowledge. Other visible callers get 403; out-of-scope and missing incidents get 404. Authentication still uses N1 bearer sessions.

Only `assigned -> in_progress` is allowed. The command increments the version once and sets `acknowledged_at` in UTC. The SQL UPDATE checks version, status and current assignment; COALESCE preserves any previously recorded acknowledgment timestamp. Repeating an old version returns 409 `version_conflict`; repeating with the current version when no longer assigned returns 409 `invalid_transition`. Neither writes again.

Incident update, public StatusHistory and AuditLog are atomic. The service uses a savepoint and leaves commit to the caller; the HTTP route commits once and rolls back on failure. The response reuses the existing `{incident, history_id}` command envelope; for acknowledgment, `history_id` references status_history. No new assignment is made, no deadline is reset, and no unsupported acknowledgment outbox event is invented. N3 SLA eligibility stops based on `acknowledged_at`; the deadline remains historical data.

Code: `AcknowledgmentService` in `backend/app/workflow/service.py` and the existing workflow router. No migration is required. Tests: `python -m pytest tests/test_acknowledgment.py -q` from backend with project dependencies installed. SQLite tests cover service/API behavior, UTC clocks, repeated calls, conditional updates and rollback. Real PostgreSQL parallel requests are verified in W7 below; the race with the SLA job is owned by N3's W7 (atomic escalation).

## W6 transitions and disposition

Endpoints: `POST /api/v1/incidents/{incident_id}/transitions` and `POST /api/v1/incidents/{incident_id}/disposition`. Both take `expected_version` (a positive integer) and reuse the existing `{incident, history_id}` command envelope; the route commits once and rolls back on failure. No outbox event is published: EventType has no transition or disposition event, same as W5 acknowledgment.

Transitions use the four edges in the contract table above: `in_progress -> resolved` (handler, manager or administrator, nonempty `resolution` required), `resolved -> closed` (manager or administrator, `reason` optional), `resolved -> in_progress` and `closed -> in_progress` (manager or administrator, `reason` required). Any other edge returns 409 `invalid_transition`; a missing resolution or reason returns 422 `validation_error`. `resolved_at` is set when resolving and `closed_at` when closing; returning or reopening keeps both timestamps and the old history, and reopen does not create a new acknowledgment deadline.

Disposition closes an incident as `duplicate` or `invalid`; it never deletes one. Only the current department manager or administrator can dispose; the assigned handler gets 403. The incident must not already be `closed` (409). `reason` is always required; `duplicate` additionally requires `duplicate_of_id`, which must exist and must not be the incident itself (422 otherwise). The audit `after` snapshot records the disposition kind and `duplicate_of_id`; `WorkflowRepository.add_audit` now allows those two fields and validates them the same way it validates status and version.

Code: `TransitionService` and `DispositionService` in `backend/app/workflow/service.py`, the two routes in `backend/app/workflow/router.py`, and the audit allowlist in `backend/app/workflow/repository.py`. No migration is required. Tests: `python -m pytest tests/test_transitions.py -q` from backend with project dependencies installed. SQLite tests cover the four transition edges, role and version handling, reopen timestamp retention, duplicate/invalid disposition, endpoint validation, authentication, record scope and rollback; 45 cases. Together with the existing workflow tests the suite is 215 passed. Real PostgreSQL parallel requests are verified in W7 below.

## W7 audit, history and concurrency

No new feature, transition or endpoint. W7 standardizes audit and history across all five N4 mutating commands and verifies concurrent updates on real PostgreSQL.

The audit/history review found one real inconsistency: the comment audit snapshot recorded only `{"version": ...}` while assign, acknowledge, transitions and disposition all record status and version. `CommentService.create` now writes `before={"status": incident.status, "version": expected_version}` and `after={"status": incident.status, "version": expected_version + 1}`. Everything else was confirmed correct and left unchanged: the assign response `history_id` is the assignment id (per the API contract), comments write no StatusHistory (its from_status/to_status constraint requires a status change), only assign publishes an outbox event, and each command's conditional UPDATE guards the fields it depends on. The `supplements` endpoint in the contract has no implementation yet and belongs to N7's W7 work.

Concurrency: two commands with the same `expected_version` must yield exactly one success and one 409 `version_conflict`, on every mutating command. Verified on real PostgreSQL (Docker Compose, database `campus_incident_test`, migrated to head `n4_w2_workflow`; see `docs/development.md` for `TEST_DATABASE_URL`). Tests: `backend/tests/test_workflow_concurrency_pg.py` runs each pair of commands in two threads with separate sessions, released together by a barrier. Six cases: concurrent resolve, acknowledge, disposition, assign and comment, plus a mixed resolve-versus-disposition race. All 6 passed: the winner commits version 2 with exactly one StatusHistory and one AuditLog (comment writes no history), the loser gets 409 `version_conflict`. The acknowledgment race with the N3 SLA escalation job is owned by N3's W7 (atomic escalation); N4's side is the version gate verified here.

Code: the comment audit fix in `backend/app/comments/service.py`; the new tests in `backend/tests/test_workflow_concurrency_pg.py`. No migration is required. Run `python -m pytest tests/test_workflow_concurrency_pg.py -q` from backend with `TEST_DATABASE_URL` pointing at `campus_incident_test`.

## W8 real API integration

No new feature, transition or endpoint, and no contract change. W8 proves the whole lifecycle runs through the real API on real PostgreSQL with the real pieces of the other areas: N1 bearer tokens and record scope, a real incident created through the N2 create API, and a real demo-v1 rule evaluation (N3) deciding department and priority.

One flow drives the full lifecycle: the reporter creates a water-leak incident near electricity through `POST /api/v1/incidents` (with a real Idempotency-Key); the real demo-v1 engine evaluates it as R03, priority p1, department "Cơ sở vật chất"; then the manager assigns, the handler acknowledges, the handler adds a public comment, the handler resolves, the manager closes, the manager reopens (keeping `resolved_at`/`closed_at`), and the manager disposes it as invalid. Version goes from 1 to 8, checked after every step from the response and from a fresh `GET`. A second test checks comment visibility through the API: the reporter sees only the public comment, the manager sees both public and internal. A third test checks the error contract through the API: a stale version returns 409 `version_conflict`, a reporter assign returns 403 `forbidden`, an out-of-scope handler returns 404 `not_found`, and a missing incident returns 404 `not_found`.

Incident creation now runs the N3 rule evaluation itself. The test checks the resulting department, priority, severity and rule ID directly in the create response. These tests need PostgreSQL because incident creation uses `pg_advisory_xact_lock`; set up `campus_incident_test` and run `alembic upgrade head` before pytest. See `docs/development.md` for `TEST_DATABASE_URL`.

Code: no production code changed. Tests: `backend/tests/test_workflow_integration_pg.py`, 3 cases, all passed. Run `python -m pytest tests/test_workflow_integration_pg.py -q` from backend with `TEST_DATABASE_URL` pointing at `campus_incident_test`. The full workflow suite (workflow, concurrency and integration tests plus comment tests) is 276 passed.

## W9 transfer visibility

No new feature, transition or endpoint, and no contract change. W9 proves that transferring an incident to another handler/department keeps the right permissions and leaks nothing on the timeline.

One flow drives the whole check: the reporter creates a water-leak incident near electricity through `POST /api/v1/incidents`; the real demo-v1 engine evaluates it as R03, priority p1, department "Cơ sở vật chất"; the manager assigns it to a handler in that department; the handler uploads a PDF attachment and adds one internal and one public comment; then the manager transfers it to a handler in "Điện và an toàn". Version goes from 1 to 6: create, assign, upload, internal comment, public comment, transfer. A first test checks the old staff lose access: after the transfer the old handler and old manager get 404 `not_found` on the incident, comments, attachments, history and attachment download, and the old manager trying to assign it back also gets 404 (out of scope, not forbidden). A second test checks the new staff gain access: the new handler reads the incident, sees both internal and public comments, lists and downloads the attachment, sees the internal comment body and the transfer (new department and handler) in the history, and can acknowledge. A third test checks the reporter timeline hides internal data: the reporter still reads their own incident and can list and download its attachments, but the history shows only public entries — no internal comment body, no transfer reason, no `handler_id`; the two assignment events appear with empty details.

The create API runs the N3 rule evaluation. Attachments use a pytest temp directory, so the test leaves no evidence files in the repo. PostgreSQL is required for incident creation; see `docs/development.md` for `TEST_DATABASE_URL`.

Code: no production code changed. Tests: `backend/tests/test_workflow_transfer_visibility_pg.py`, 3 cases. Run `python -m pytest tests/test_workflow_transfer_visibility_pg.py -q` from backend with `TEST_DATABASE_URL` pointing at `campus_incident_test`.

## W10 negative lifecycle cases

No new feature, transition or endpoint, and no contract change. W10 covers the negative cases of the test plan (T07–T09) through the real API on real PostgreSQL, plus a sweep of the unlisted transition edges at every state.

Two things changed before the new tests. First, N3's rule integration merged into main (PR #54), so incident creation now runs the demo-v1 engine itself. The W8 and W9 tests dropped their `apply_rule` stand-in: they now assert department, priority, severity and the rule id directly from the create response. Second, the test database needed no new migration: the Alembic head is still `n1_n2_w6_merge`, and `alembic` must be run with `DATABASE_URL` pointing at `campus_incident_test` — it reads `DATABASE_URL`, not `TEST_DATABASE_URL`.

Four new cases in `backend/tests/test_workflow_negative_pg.py`. T07: one reporter swapping the id to read, comment on, upload to or download another reporter's incident gets 404 `not_found` on every call, and no title, comment body or file name leaks into any response. T08: other-department handlers and managers get 404 (not 403) on acknowledge, transitions, internal comments, upload, download, assign and disposition. T09: reporters and handlers get 403 `forbidden` on close, return and disposition; a manager may close without a reason, but returning or reopening without a reason is 422 `validation_error`. A final test sweeps the unlisted edges at every state: reported→resolved, assigned→resolved, in_progress→closed, resolved→resolved and closed→resolved all return 409 `invalid_transition`; resolving without a resolution and returning without a reason return 422; disposition on a closed incident returns 409; duplicate pointing at itself or at a missing incident returns 422. Every blocked call leaves the version unchanged. One check first failed and corrected the test, not the code: an unassigned handler calling transitions on a `reported` incident gets 404 (out of scope) rather than 409, so that edge is checked with the department manager instead.

Code: no production code changed; the W8 and W9 test files were updated to the integrated create flow. Tests: `backend/tests/test_workflow_negative_pg.py` (4 cases), `backend/tests/test_workflow_concurrency_pg.py` (6 race cases), and `backend/tests/test_workflow_storage.py` (rollback checks). Run them from backend with `TEST_DATABASE_URL` pointing at `campus_incident_test`.
