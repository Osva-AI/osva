# M14.6 acceptance — security audit and incident response

## Event coverage

| Event | Durable PostgreSQL audit | Structured log (`emitSecurityEvent`) |
| --- | --- | --- |
| Authentication failure | `user.login_failed` (identity flows) | `auth.authentication_failed` |
| Session revocation | `user.session_revoked` | — |
| API key create/revoke | **`api_key.created` / `api_key.revoked`** (domain → Postgres repo, same transaction as mutation) | existing HTTP structured events |
| Workspace membership / role | existing identity lifecycle events | partial |
| Connector credential updates | — | secret resolution failures |
| Unauthorized tool invocation | — | via run/tool errors (not duplicated per call) |
| Cross-workspace denial | **`authorization.denied` type exists in contracts only** | `auth.authorization_denied` |
| Approval decision | **`approval_request.decided`** (domain → Postgres repo, same transaction as CAS transition) | — |
| Capability failure | **`capability.authorization_failed` type exists in contracts only** | runtime HTTP errors |
| Admin security config | — | console / rate-limit events |

Durable coverage reflects **implemented producers only**. Types without a Postgres append path are log/telemetry unless noted above.

## Durability and atomicity

- Identity and membership mutations use transactional lifecycle repositories (mutation + audit row in one DB transaction).
- **API key create/revoke** (`CreateWorkspaceApiKey`, `RevokeWorkspaceApiKey`) call `PostgresApiKeyRepository.createWithAudit` / `revokeWithAudit`: insert/update and audit insert share one transaction; audit failure rolls back the mutation.
- **Approval decisions** (`DecideApprovalRequest`) call `PostgresApprovalRequestRepository.saveApprovalRequestTransitionWithAudit`: CAS status update and audit insert share one transaction; audit failure leaves the request `PENDING`.
- Idempotent API key revoke (already revoked) returns without appending a second audit event.
- Idempotent approval retry (same terminal decision) returns the stored request without a misleading second audit event.
- Structured security events remain best-effort stdout/metrics via `@osva/observability`.

Production control-plane paths do **not** rely on optional HTTP-layer audit wiring; auditing is required at the repository boundary for the mutations above.

## Tenant scoping

- `security_audit_events.workspace_id` enforced on list APIs (`GET /v1/auth/audit-events`).
- Audit builders set `workspaceId` from control plane scope; list APIs do not cross workspaces.

## Redaction

- Audit details exclude tokens, secrets, and capability values by construction in control-plane audit builders.
- API key audit records ids/roles/subject only—never plaintext keys.

## Failure semantics

- Repository audited methods propagate persistence failures; callers must not treat mutations as committed when the transaction throws.
- `appendSecurityAuditEvent` (standalone helper) still throws on failure—used where append is intentionally separate (e.g. human auth HTTP).

## Tests

- `packages/db/test/integration/audited-control-plane-mutations.integration.test.ts` — atomic commit, audit-failure rollback, idempotent revoke, concurrent decision audit count, workspace scoping, redaction.
- `packages/domain/test/append-security-audit-event.test.ts` — standalone append helper.

## Documentation

- `docs/operations/SECURITY_INCIDENT_RESPONSE.md` — operator runbook.

## Remaining gaps

- Tool invocation denials not durably audited per attempt (volume/noise).
- `authorization.denied` and `capability.authorization_failed` are not durably produced in this slice.
- Connector credential rotation lacks dedicated durable event (use secret resolution + operator logs).
- No built-in SIEM export; ship logs externally.
- Bootstrap API key creation uses non-audited `create()` (installation-only path).

## Verification (M14.6 gate)

- `pnpm --filter @osva/db test:integration -- audited-control-plane-mutations`
- `pnpm --filter @osva/domain test -- append-security-audit-event`
