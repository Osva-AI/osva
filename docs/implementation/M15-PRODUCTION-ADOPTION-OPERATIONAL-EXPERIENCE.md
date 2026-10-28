# M15 — Production adoption and operational experience

**Baseline:** Community **`1.1.0-rc.4`** · Git tag **`v1.1.0-rc.4`** → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** · Drizzle head **`0030_approval_operation_binding_slice`**.

**Prior milestones:** M13 no-code Console closeout · M14 security closeout ([`../operations/M14_7_SECURITY_CLOSEOUT.md`](../operations/M14_7_SECURITY_CLOSEOUT.md)).

**Objective:** Make shipped product and security work adoptable by operators — accurate docs, upgrade paths, Console acceptance gaps closed, and a unified acceptance replay before declaring production-adoption ready.

Verification policy: [`../engineering/DEVELOPMENT_GATES.md`](../engineering/DEVELOPMENT_GATES.md) and [`../engineering/OSVA_VERIFICATION_STRATEGY.md`](../engineering/OSVA_VERIFICATION_STRATEGY.md).

## Progress

| Slice | Status | Notes |
| --- | --- | --- |
| M15.1 Baseline and roadmap reconciliation | **Complete** (documentation) | Tracker, stage roadmap, UPGRADE **`0029`/`0030`**, RC.4 verification record, Console surface docs |
| M15.2 Evaluation Studio browser acceptance | **Complete** (browser suite) | `m13-7-5-browser.integration.test.ts`; see M13.7.5 / M15.2 evidence |
| M15.3 Operator experience hardening | **Complete** (Console UX) | Shared operator diagnostics on Run, WorkflowRun, connector, model, and knowledge surfaces |
| M15.4 Unified adoption acceptance | **Complete** | `pnpm acceptance:m15` · [`../operations/M15_4_ACCEPTANCE_SUMMARY.md`](../operations/M15_4_ACCEPTANCE_SUMMARY.md) · **`full`** profile **PASS** **2026-10-28** |
| M15.5 Production adoption closeout | **Complete** | [`../operations/M15_ACCEPTANCE_SUMMARY.md`](../operations/M15_ACCEPTANCE_SUMMARY.md) · [`../operations/M15_CLOSEOUT_SUMMARY.md`](../operations/M15_CLOSEOUT_SUMMARY.md) |

## M15.1 — Baseline and roadmap reconciliation

**Scope (documentation only):**

- Record M14 complete in [`../roadmap/IMPLEMENTATION_TRACKER.md`](../roadmap/IMPLEMENTATION_TRACKER.md) with merge commits and ops evidence.
- Align [`../roadmap/STAGE_ROADMAP.md`](../roadmap/STAGE_ROADMAP.md) with M15 scope.
- Document migrations **`0029`** and **`0030`** (and intervening **`0027`/`0028`**) in [`../operations/UPGRADE.md`](../operations/UPGRADE.md); preserve forward-only migration rules.
- Reconcile [`../release/RC4_VERIFICATION.md`](../release/RC4_VERIFICATION.md) with registry/CI evidence; do not mark gates complete without proof.
- Correct Console docs for shipped Knowledge, Memory, Testing Studio, and Models surfaces ([`../engineering/CONSOLE.md`](../engineering/CONSOLE.md)).

**Out of scope:** REST, database, runtime, or security behavior changes.

**Acceptance:** Doc links resolve; `git diff --check` clean; `pnpm verify:changed` or Prettier on touched markdown.

## M15.2 — Evaluation Studio browser acceptance

**Problem:** M13.7.5 closeout records **INDETERMINATE** / quality-gate Console UX as **NOT EXECUTED** in Playwright ([`../operations/M13_7_5_CLOSEOUT_SUMMARY.md`](../operations/M13_7_5_CLOSEOUT_SUMMARY.md)).

**Scope:**

- Extend or add Playwright coverage under `apps/console/test/integration/` for:
  - Launch evaluation run with `qualityGatePolicy` from Console
  - Run detail presentation of terminal gate assessment (**PASS** / **FAIL** / **INDETERMINATE**)
  - Explicit copy that coordinator **COMPLETED** ≠ gate **PASS**
- Wire into branch-impact / optional CI obligation map per [`../engineering/BRANCH_VERIFICATION.md`](../engineering/BRANCH_VERIFICATION.md).

**Out of scope:** New evaluators, LLM-as-judge, REST contract changes.

**Acceptance:** New browser test(s) green locally with M12.3 human-session harness; `pnpm verify:branch` when Console integration paths change.

## M15.3 — Operator experience hardening

**Scope (Console UX + docs, no control-plane contract breaks):**

- Shared operator diagnostics helper (`apps/console/src/client/lib/operator-diagnostics.ts`) and `OperatorGuidancePanel` for consistent severity, next steps, and recoverability copy.
- **Run Detail:** lifecycle guidance for **QUEUED** / **RUNNING** (without inventing worker health), failure remediation from persisted attempt error codes (including **EXECUTION_INTERRUPTED** and **UNSUPPORTED_RUNTIME**), alongside existing execution lease diagnostics.
- **WorkflowRun Detail:** terminal **FAILED** and suspended **WAITING** operator copy; no unsupported replay/cancel actions.
- **Connectors:** discovery/import/append failures use actionable error panels; zero-tool discovery is not treated as silent success.
- **Model connections:** connectivity test **READY** vs **FAILED** categorization without exposing credentials.
- **Knowledge index FAILED:** remediation steps plus existing retry control.
- **ErrorState:** surfaces rate-limit and dependency-unavailable guidance for `ConsoleApiError` responses (aligned with BFF humanization).

**Known limitations (unchanged):**

- Console still cannot verify worker queue consumption or connector reachability without a successful control-plane operation.
- No generic Run retry button; new logical Runs only where EXECUTE already exists.
- STDIO connector creation remains restricted; discovery guidance explains read-only Console behavior.
- Evaluation **INDETERMINATE** quality-gate browser copy remains covered by M15.2; no duplicate gate UX in this slice.

**Verification (M15.3):**

- `pnpm --filter @osva/console exec vitest run test/operator-diagnostics.test.ts test/error-state.test.tsx test/run-detail-page.test.tsx test/workflow-run-detail.test.tsx`
- `pnpm verify:changed` on the M15.3 branch

**Acceptance:** Documented operator journeys below; focused Console unit tests for changed surfaces.

## M15.4 — Unified adoption acceptance

**Delivered (orchestration):**

- `pnpm acceptance:m15` with profiles **`default`**, **`integration`**, **`browser`**, **`full`** and journey groups **A–G** (see [`../operations/M15_4_ACCEPTANCE_SUMMARY.md`](../operations/M15_4_ACCEPTANCE_SUMMARY.md)).
- Reuses M12.3, M13 browser suites, M15.3 operator unit tests, canonical example integration, M14 adversarial/HTTP/approval DB tests, and RC4 version/pack smoke — no duplicated Vitest implementations.
- Branch-impact **`operator-diagnostics`** targeted tests for M15.3 Console paths.

**Closeout evidence (M15.4 / M15.5):**

- Operator **`full`** profile **PASS** — **23/23** steps, **`artifacts/acceptance/m15-4/latest.json`** (**2026-10-28T08:55:24Z**).
- npm **`@rc`** registry check **PASS** inside **`full`** run.
- **`applied_and_matches`** on long-lived operator DB remains **deferred** (not in orchestration catalog).

**Acceptance:** Summary doc + evidence JSON; mandatory journeys **PASS** via **`full`** profile (see M15.5 acceptance summary).

## M15.5 — Production adoption closeout

**Delivered:**

- [`../operations/M15_ACCEPTANCE_SUMMARY.md`](../operations/M15_ACCEPTANCE_SUMMARY.md) and [`../operations/M15_CLOSEOUT_SUMMARY.md`](../operations/M15_CLOSEOUT_SUMMARY.md).
- Reconciled [`../release/COMPATIBILITY.md`](../release/COMPATIBILITY.md) and [`../release/RELEASE_CANDIDATE_INVENTORY.json`](../release/RELEASE_CANDIDATE_INVENTORY.json) with verified RC.4 channel status (npm **published**; PyPI/GHCR/M10.4E **pending**).
- Residual risks: partial distribution, fixture-backed adoption proof, workflow vs tool-call approval granularity (M14).

**Acceptance:** IMPLEMENTATION_TRACKER updated; focused verification on closeout docs. `pnpm verify:ci:clean` **not** re-run — GitHub **CI** **`verify:ci`** **success** on **`045122e`** recorded instead.

## Dependencies

- PostgreSQL migration head **`0030`** for full M14 approval binding and M13.7.5 gates.
- Human bootstrap (`pnpm identity:bootstrap`) for Console browser tests.
- Knowledge worker + embedding env for Knowledge Studio acceptance (existing M13.5 harness).
