# Incident data model

This document defines the stable N2 data model for the three MVP report types. W1 adds SQLAlchemy metadata only; W2 will add the database migration. The API request and response remain defined in [the API contract](api-contract.md); shared synthetic examples are in [incidents.json](fixtures/incidents.json).

## Tables

### `incidents`

One row represents one report. PostgreSQL stores `answers` as a JSONB object inside the incident; it is not a separate table because each category has different answer keys and the API returns answers as one object.

| Field | Type | Rule / owner |
| --- | --- | --- |
| `id` | UUID | Server-generated primary key. Never accepted from the create request. |
| `reporter_id` | UUID | Foreign key to `users.id`; derived from the authenticated session, never from request JSON. |
| `category` | string | `water_leak`, `electrical_hazard`, or `phishing`. |
| `title`, `description`, `building` | string | Contract limits: 5–120, 20–2000, and 1–120 characters. |
| `location_detail` | string or null | Up to 200 characters. |
| `observed_at` | timestamptz or null | Reporter-provided observation time in UTC; reject future values. |
| `answers` | JSONB object | Required keys and values depend on `category`; reject unknown keys. |
| `status`, `version` | string, integer | Starts as `reported`, version `1`. Every committed incident change increments the version once; stale `expected_version` returns 409 without a write. N4 owns lifecycle transitions. |
| `triage_required`, `severity`, `priority`, `department_id`, `assigned_handler_id`, `rule_evaluation`, `acknowledgment_deadline_at`, `escalation_level` | mixed | Classification and SLA fields may be null until evaluated. N3 owns rule/SLA changes; assignment and lifecycle changes follow the API contract and N4 boundary. |
| `reported_at`, `updated_at`, `assigned_at`, `acknowledged_at`, `resolved_at`, `closed_at` | timestamptz | Server-generated or server-updated, stored with timezone and returned as ISO 8601 UTC. |

Validate `answers` in the API layer against the category schemas in the contract. Do not accept reporter, actor, status, priority, severity, or department values from a create request.

### `incident_attachments`

This table stores evidence metadata, not file bytes. Keep file bytes in private storage and save only a random `storage_key`; never return that key or expose a public file URL. Store `id` (UUID), `incident_id`, `uploaded_by`, `storage_key`, `original_name`, `content_type`, `size_bytes`, and server-generated `created_at`. Enforce the contract's PDF/PNG/JPEG allowlist, 10 MiB per file, and five-file incident limit in the upload service. Upload occurs after incident creation.

### `idempotency_records`

Use `(user_id, key)` as the primary key, where `key` is the UUID from `Idempotency-Key`. Store a SHA-256 `request_fingerprint` of the validated request, `incident_id`, server-generated `created_at`, and `expires_at` (24 hours after creation). The same user/key and fingerprint returns the existing incident; the same user/key with a different fingerprint returns 409. Save this record in the same transaction as the incident and N5's `incident.reported` outbox event. Expired rows may be purged so old keys can be reused.

## Shared fixture conventions

- `fixture_id` is a stable human-readable fixture label, not a database ID. Database IDs are server-generated UUIDs; fixed UUIDs in fixtures are only for mock responses and tests.
- Every create request has a fixed UUID idempotency key. Reuse it only with the same request body; issue a new key after changing the body.
- Fixture timestamps are fixed ISO 8601 UTC values ending in `Z`. `observed_at` must not be in the future. `reported_at` in a mock response is clearly labeled sample data; production values come from the server.
- Fixtures contain no real people, credentials, secrets, or binary attachments. Evidence is uploaded separately using the attachment API.
- `expected_evaluation` describes the demo rule result after evaluation; it is not a field the reporter sends in the create request.
