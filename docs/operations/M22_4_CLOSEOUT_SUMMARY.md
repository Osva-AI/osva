# M22.4 â€” Worker execution, handoffs, and human approvals (Aâ€“D)

**Branch:** `feat/m22-4-worker-execution-handoffs`
**Milestone slices:** M22.4A execution context, M22.4B workflow handoffs, M22.4C human approvals, M22.4D acceptance and closeout
**Status:** Implemented, awaiting combined Aâ€“D PR and hosted CI (`pnpm verify:ci:clean`)

## Deliverables (Aâ€“D)

| Slice | Scope |
| --- | --- |
| M22.4A | Domain execution projections, Task/Worker execution UI, timeline and catalog attribution |
| M22.4B | Workflow handoff graph, team context, edge semantics faithful to persisted node runs |
| M22.4C | Task approval section, shared `WorkflowApprovalActions`, inbox `assignmentId` join, cache invalidation |
| M22.4D | Real-stack acceptance, ambiguous inbox mapping hardening, closeout documentation |

Architecture references: [M22_4A_EXECUTION_CONTEXT.md](../architecture/M22_4A_EXECUTION_CONTEXT.md), [M22_4B_WORKFLOW_HANDOFFS.md](../architecture/M22_4B_WORKFLOW_HANDOFFS.md), [M22_4C_HUMAN_APPROVALS.md](../architecture/M22_4C_HUMAN_APPROVALS.md).

## Canonical architecture

- **Task** (`Assignment`) freezes `AgentVersion` or `WorkflowVersion` at creation; **launch** is the sole execution entry (no enqueue on create).
- **Mission** (`Goal`) links tasks; progress remains client-derived from reconciled assignment statuses.
- **Execution evidence** always comes from `Run` / `WorkflowRun` / `WorkflowNodeRun` and pinned `WorkflowVersion` definitions â€” projections never invent handoffs or completions.
- **Approvals** reuse `ApprovalRequest` + `DecideApprovalRequest`; orchestration resumes after durable transitions.

## Inbox assignment mapping rules (M22.4C/D)

PostgreSQL `listInboxItems` loads workspace assignments with non-null `workflowRunId` and:

1. **Exactly one** assignment for a `workflowRunId` â†’ approval inbox row includes `assignmentId` (Task Detail navigation).
2. **Zero** Office assignments â†’ approval row has `workflowRunId` only (WorkflowRun detail navigation).
3. **Multiple** assignments for the same `workflowRunId` â†’ `assignmentId` omitted (no arbitrary pick).

Cross-workspace isolation follows existing assignment and approval predicates. Pagination dedupes by inbox item id before sort/cursor.

## Security and authorization

Unchanged M22.3 / workflow matrices: READ for execution surfaces; `EXECUTE` for launch, cancel, and approval decisions. VIEWER may read inbox and execution context but cannot decide approvals or ack operational items where policy denies WRITE/EXECUTE. Human session required for Console mutations; API key remains control-plane scoped.

## Real-stack acceptance evidence (M22.4D)

| Scenario | Evidence |
| --- | --- |
| Mission â†’ workflow assignment â†’ Agent A â†’ approval â†’ Agent B â†’ COMPLETED | `apps/worker/test/integration/m22-4-office-workflow-acceptance.integration.test.ts` |
| Approval rejection (no successor agent) | Same file, rejection case |
| PostgreSQL inbox mapping Aâ€“F | `packages/db/test/integration/office-inbox-assignment-mapping.integration.test.ts` |
| HTTP inbox `assignmentId` enrichment | `apps/web/test/integration/office-collaboration-acceptance.integration.test.ts` (M22.4D case) |
| Domain projections (execution, handoff, approval, inbox) | `packages/domain/test/office-*-projection.test.ts` |
| Console hooks / UI | `apps/console/test/office-*.test.ts(x)` |

**Browser vs backend:** existing Playwright suites (e.g. workflow-run detail approval mock routes) validate Console layout only. M22.4D execution proof is integration/worker/DB backed.

## Performance and polling (reviewed)

- Task detail: existing assignment reconcile poll while `RUNNING`; workflow runs use `workflowRunRefetchInterval` when non-terminal.
- Approval mutations invalidate workspace-pinned workflow, assignment, and inbox query keys; no optimistic assignment completion.
- Worker history and catalog helpers bounded (existing M22.4A/B notes); no new polling loops added in M22.4.

## Known limitations

- Mission approval attention is inbox-scoped (pending only), not exhaustive mission fan-out.
- Ambiguous `workflowRunId` â†” assignment relationships omit inbox `assignmentId`.
- Explicit `officeWorkerId` on AGENT nodes remains deferred (catalog attribution).
- `@osva/db` package consumers must rebuild after repository changes for dist-aligned integration tests.

## Deferred (M22.5+)

Activity feeds, deliverable automation, worker performance dashboards, HumanTask persistence, autonomous delegation, new approval state machine â€” see [M22_VIRTUAL_OFFICE.md](../roadmap/M22_VIRTUAL_OFFICE.md).

## Migrations

None for M22.4.

## Local verification (M22.4D session)

Commands run direct (no Turbo cache for new integration files):

```text
pnpm --filter @osva/db build
pnpm --filter @osva/db exec vitest run --config vitest.integration.config.ts test/integration/office-inbox-assignment-mapping.integration.test.ts   # 6/6 pass
pnpm --filter @osva/worker exec vitest run --config vitest.integration.config.ts test/integration/m22-4-office-workflow-acceptance.integration.test.ts   # 2/2 pass
pnpm --filter @osva/domain exec vitest run test/office-execution-context-projection.test.ts test/office-workflow-handoff-projection.test.ts test/office-task-approval-projection.test.ts test/office-inbox-projection.test.ts   # 26/26 pass
pnpm --filter @osva/console exec vitest run test/office-execution-context.test.ts test/office-task-execution-handoff.test.ts test/office-workflow-approval-hooks.test.ts test/office-tasks-ui.test.tsx   # 15/15 pass
```

Hosted obligations after human commit: `pnpm verify:pre-push`, GitHub Actions clean matrix (`pnpm verify:ci:clean`), optional full office collaboration integration in CI.

## Git / GitHub

AI agents performed **no** git staging, commits, pushes, or GitHub writes during M22.4D.
