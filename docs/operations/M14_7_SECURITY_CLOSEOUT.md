# M14.7 security closeout

Branch: `feat/m14-5-7-security-closeout`
Baseline: `4e1797dd048b38993d598bceee4b2b5ffc6169af`

## Milestone status

| Milestone | Status | Evidence |
| --- | --- | --- |
| M14.0 audit | Complete (prior) | prior ops summaries |
| M14.1 ToolGateway/MCP | Complete (prior) | `M14_1_ACCEPTANCE_SUMMARY.md` |
| M14.2 Human auth / CSRF / rate limit | Complete (prior) | `M14_2_ACCEPTANCE_SUMMARY.md` |
| M14.3 Capability tokens | Complete (prior) | `M14_3_ACCEPTANCE_SUMMARY.md` |
| M14.4 Adversarial acceptance | Complete (prior) | `M14_4_ACCEPTANCE_SUMMARY.md` |
| M14.5 Approval hardening | **Complete** | `M14_5_ACCEPTANCE_SUMMARY.md` |
| M14.6 Audit + IR | **Complete (scoped)** | `M14_6_ACCEPTANCE_SUMMARY.md`, `SECURITY_INCIDENT_RESPONSE.md` |
| M14.7 Closeout | **Complete** | this document |

## Control matrix (abbreviated)

| Threat | Control | Enforcement | Test | Result | Residual |
| --- | --- | --- | --- | --- | --- |
| Prompt injection privilege | ToolGateway/MCP policy | `ToolGateway.invoke` | M14.4 | PASS | Authorized-tool misuse |
| Forged approval text | Persisted ApprovalRequest | Domain state | M14.4/5 | PASS | Tool-call approval N/A |
| Approval substitution | Operation digest (node input) | Decide + reconcile | M14.5 + PG integration | PASS | Tool args not bound |
| Cross-workspace API | Scope + repos | HTTP + domain | REST matrix + audit list | PASS | Misconfigured keys |
| CSRF on human mutations | Origin check | `human-auth-http` | M14.2 | PASS | New routes must opt in |
| Capability replay | Execution lease | Runtime HTTP | M14.3 | PASS | Active lease window |
| Audit tampering | Append-only table | DB + API read auth | PG audited mutation tests | PASS (scoped) | No immutability proofs |
| Audit loss on mutation | Transactional audit | Postgres repos | `audited-control-plane-mutations` | PASS | Bootstrap key create unaudited |

## Risk register (concise)

| Risk | Sev | Mitigation | Residual | Owner |
| --- | --- | --- | --- | --- |
| Prompt injection | High | Gateways, adversarial tests | Model may exfiltrate via allowed tools | Platform + agent authors |
| Authorized-tool misuse | High | Schema + approval + egress | Permissive tools echo data | Agent developers |
| Capability replay (active lease) | Med | Lease-bound tokens | TOCTOU at expiry | Platform |
| Approval granularity | Med | Workflow node binding | No tool-call approval | Product |
| Audit durability gaps | Med | Transactional audit for keys/approvals | Denial events mostly log-only | Ops |
| Worker compromise | High | Immutable agent versions | Host breakout | Infra |
| Multi-tenant isolation | High | Scoped repos + FK | Misconfiguration | Ops |

## Regression evidence (closeout corrections)

- PostgreSQL audited control-plane mutations — integration tests
- PostgreSQL approval binding (0030) — integration tests
- Domain approval binding + orchestration approval suite — unit tests

Full repository gate: operator runs `pnpm verify:changed` once after review.

## Release readiness

**Security closeout does not imply universal production readiness.** Implementation is **ready for manual commit and review** after `verify:changed` passes. Operator may run `verify:ci:clean` before release.
