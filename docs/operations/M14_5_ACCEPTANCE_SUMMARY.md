# M14.5 acceptance — operation-bound human approval security

## Threat model

| Threat | Intent |
| --- | --- |
| Approval payload substitution | Approve operation A, execute B |
| Approval replay | Reuse a spent approval for another side effect |
| Cross-workspace / cross-run confusion | Apply a decision outside its tenant or run |
| Post-approval mutation | Change APPROVAL input after human decision |
| Narrative forgery | Agent text claims approval without persisted state |
| Concurrent decisions | Double-authorize under race |

## Existing behavior (pre-M14.5)

- Workflow APPROVAL nodes materialize one `ApprovalRequest` per `WorkflowNodeRun` (unique constraint).
- Decisions are CAS-serialized (`PENDING → APPROVED|REJECTED`).
- Scope enforced via workspace-scoped repository lookups and FKs to workflow run / node run.
- Workflow progression approval only; not tool-call authorization (`docs/contracts/WORKFLOW_DEFINITION_V2.md`).

## Implemented controls

1. **Immutable operation binding** — On creation, orchestrator stores `operationKind` + `operationDigest` for **`WORKFLOW_NODE_PROGRESSION`** (workflow node progression bound to **frozen node input**, not individual ToolGateway tool calls).
2. **Decision-time verification** — `DecideApprovalRequest` reloads the node run and verifies binding + optional `expiresAt` before APPROVED transitions.
3. **Resume-time verification** — `observeApprovalDecisions` re-verifies binding before `markSucceeded`; mismatch fails the node with `APPROVAL_OPERATION_MISMATCH`.
4. **Legacy compatibility** — Requests without binding metadata skip digest checks (pre-migration / test fixtures).
5. **Tool invocation binding (contract-only)** — Digest helpers and verifier for future tool-call approvals; **not** wired into ToolGateway in this slice.

## Operation binding semantics

- Digest algorithm: canonical JSON (sorted keys) → SHA-256 → `sha256:<hex>`.
- Binding document schema version `1`; kind `WORKFLOW_NODE_PROGRESSION`.
- Secrets must not be hashed into audit-visible fields; only structured node input is digested.

## Test coverage

| # | Scenario | Location | Result |
| --- | --- | --- | --- |
| 1 | Legitimate approval | `reconcile-workflow-approval.test.ts` | PASS |
| 2 | Rejected approval | same | PASS |
| 3 | Expired approval | `approval-operation-binding.test.ts` | PASS |
| 4–5 | Foreign workspace/run | Existing HTTP + repository scoping tests | PASS (unchanged) |
| 6–7 | Modified payload / tool identity | `approval-operation-binding.test.ts` | PASS |
| 8 | Replay | Node terminal state + CAS decisions | PASS (orchestration) |
| 9 | Concurrent decisions | `reconcile-workflow-approval.test.ts` | PASS |
| 10 | Resume after tamper | `reconcile-workflow-approval.test.ts` (new) | PASS |
| 11 | Narrative forgery | M14.4 fixtures + persisted state | PASS |
| 12 | Legacy APPROVAL workflows | Legacy create path without digest | PASS |

## Database

Migration `0030_approval_operation_binding_slice.sql` adds nullable `operation_kind`, `operation_digest`, `expires_at` to `approval_requests`.

## Remaining limitations

- Workflow-definition-driven approval TTL not exposed on APPROVAL nodes.
- **Per-tool-call approval is not enforced** at ToolGateway (binding helpers exist for future use only).
- Digest does not cover downstream agent tool arguments—only workflow node progression input.
- **`PENDING` approvals past `expiresAt`:** decision/resume verification rejects APPROVED transitions; the workflow remains **WAITING** until an operator rejects, the run is cancelled, or binding/input is corrected. There is **no automatic terminal transition** in the current product contract.

## PostgreSQL (migration 0030)

Integration tests in `packages/db/test/integration/approval-requests.integration.test.ts` verify `operation_kind`, `operation_digest`, and `expires_at` round-trip, legacy NULL rows, binding preservation on decision, tampered node input verification, and concurrent CAS behavior.

## Verification (M14.5 gate)

- `pnpm --filter @osva/domain test -- approval-operation-binding` — exit **0**
- `pnpm --filter @osva/orchestration test -- reconcile-workflow-approval` — exit **0**
