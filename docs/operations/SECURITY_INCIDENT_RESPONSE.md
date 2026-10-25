# Security incident response (OSVA OSS)

Actionable operator procedures for common OSVA security incidents. Distinguishes **product controls** (what the platform enforces) from **manual steps** (what operators must do).

## Evidence preservation

1. Capture `x-osva-request-id` from affected API responses and worker logs.
2. Export workspace-scoped durable audit events: `GET /v1/auth/audit-events` (human session, `audit_events_list` permission).
3. Preserve PostgreSQL snapshots for `approval_requests`, `security_audit_events`, `api_keys`, and relevant `workflow_runs` / `workflow_node_runs` rows.
4. Do not copy API key plaintext, session cookies, connector secrets, or runtime capability tokens into tickets.

## Suspected stolen API keys

**Product:** Keys are stored as digests; revocation is immediate via `POST /v1/api-keys/:id/revoke`. Durable `api_key.created` / `api_key.revoked` events are written in the **same PostgreSQL transaction** as the key mutation (not optional HTTP append).

**Operator:**

1. Revoke the key in the owning workspace.
2. Review `security_audit_events` and structured logs for `api_key.created` / authorization denials.
3. Rotate any downstream integrations that embedded the token.
4. Issue a replacement key with least-privilege role.

## Compromised human sessions

**Product:** Better Auth sessions; logout and membership removal stop future human access. Login success/failure events are durably recorded for identity flows.

**Operator:**

1. Remove or downgrade the user’s workspace membership.
2. Invalidate sessions via auth provider operations (restart auth DB session table purge only with change control).
3. Review audit events for membership and login anomalies.

## Exposed connector credentials

**Product:** Connector secrets are references resolved at runtime; not returned by list/get APIs.

**Operator:**

1. Rotate the secret in the secret store backing `ProcessEnvSecretResolver` or your vault.
2. Update connector version secret references and redeploy workers.
3. Review tool invocation logs and `connector.*` security events for abuse.

## Agent prompt-injection incident

**Product:** ToolGateway/MCP authorization, memory mutation gates, adversarial acceptance fixtures (M14.4). Prompt text cannot approve workflows or grant tools.

**Operator:**

1. Identify runs/workflow runs involved; cancel or fail active runs if needed.
2. Tighten tool schemas, approval gates, and egress policy—not prompt sanitization alone.
3. Re-run evaluation/adversarial tests for the affected agent bindings.

## Unauthorized tool invocation

**Product:** Denials return `TOOL_NOT_AUTHORIZED`; cross-workspace access is rejected at repositories.

**Operator:**

1. Correlate run id, tool version id, and binding name from run steps.
2. Verify agent version bindings and connector profiles were not widened unexpectedly.

## Unexpected cross-workspace access

**Product:** Control plane scope checks `principal.workspaceId`; foreign workspace ids return 404/403 without leaking existence.

**Operator:**

1. Confirm API key or human session workspace selection headers.
2. Review `auth.authorization_denied` structured logs. Durable `authorization.denied` audit rows are **not** produced unless a future producer is implemented.

## Runtime capability token exposure

**Product:** HMAC capability tokens are scoped to execution leases (M14.3).

**Operator:**

1. Cancel the affected run attempt / workflow run to end the lease where possible.
2. Block network paths to the runtime listener at the infrastructure layer.
3. Rotate capability signing secrets per deployment runbook.

## Worker compromise

**Operator:**

1. Drain and stop workers; revoke API keys used by worker processes.
2. Redeploy from known-good artifacts; verify image digests for CONTAINER agents.
3. Compare effective bindings on suspicious runs against pinned agent versions.

## Revocation and containment checklist

- [ ] Revoke API keys and human sessions implicated
- [ ] Cancel or fail active runs/workflow runs
- [ ] Rotate connector/model secrets referenced by affected agents
- [ ] Capture audit + request ids
- [ ] Block egress at network layer if exfiltration suspected

## Recovery verification

1. Run targeted Vitest security suites (`@osva/adversarial-acceptance`, approval/orchestration tests).
2. Run repository verification gate (`pnpm verify:changed` or `pnpm verify:ci:clean`) before returning to normal traffic.

## Post-incident review

Document root cause, blast radius, controls that worked, gaps (audit durability, approval granularity, egress limits), and owners for follow-up mitigations.

## Unsupported / manual-only today

- Central SIEM export (use log shipping from stdout JSON security events).
- Automatic approval TTL in workflow definitions (optional `expiresAt` on requests is supported at persistence layer only).
- Tool-call-bound human approval enforcement in ToolGateway (binding helpers exist; **workflow node progression** approvals are enforced).
- Automatic workflow failure when an approval stays `PENDING` past `expiresAt` (operators must reject or cancel; workflow remains WAITING).
- Prompt injection and **authorized-tool misuse** remain platform risks—incident response relies on gateway policy, bindings, and egress controls, not prompt sanitization alone.
