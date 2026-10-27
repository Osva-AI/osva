# M15 — Production adoption and operational experience

**Baseline:** Community **`1.1.0-rc.4`** · Git tag **`v1.1.0-rc.4`** → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** · Drizzle head **`0030_approval_operation_binding_slice`**.

**Prior milestones:** M13 no-code Console closeout · M14 security closeout ([`../operations/M14_7_SECURITY_CLOSEOUT.md`](../operations/M14_7_SECURITY_CLOSEOUT.md)).

**Objective:** Make shipped product and security work adoptable by operators — accurate docs, upgrade paths, Console acceptance gaps closed, and a unified acceptance replay before declaring production-adoption ready.

Verification policy: [`../engineering/DEVELOPMENT_GATES.md`](../engineering/DEVELOPMENT_GATES.md) and [`../engineering/OSVA_VERIFICATION_STRATEGY.md`](../engineering/OSVA_VERIFICATION_STRATEGY.md).

## Progress

| Slice | Status | Notes |
| --- | --- | --- |
| M15.1 Baseline and roadmap reconciliation | **Complete** (documentation) | Tracker, stage roadmap, UPGRADE **`0029`/`0030`**, RC.4 verification record, Console surface docs |
| M15.2 Evaluation Studio browser acceptance | **Planned** | Close M13.7.5 Playwright gap |
| M15.3 Operator experience hardening | **Planned** | Day-two friction and runbook clarity |
| M15.4 Unified adoption acceptance | **Planned** | Canonical example + Console on RC.4 artifacts |
| M15.5 Production adoption closeout | **Planned** | Acceptance summaries and residual risks |

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

**Scope (product docs + Console UX, no control-plane contract breaks):**

- Reduce setup/upgrade confusion: cross-link UPGRADE, RUNBOOK, LOCAL_DEVELOPMENT, and RC.4 publication status.
- Console: clearer errors for rate limits, migration-behind `/ready`, knowledge index **FAILED**, evaluation **INDETERMINATE** cost gates.
- Optional: consolidate “first hour” operator checklist in [`../OSS-COMMUNITY-QUICKSTART.md`](../OSS-COMMUNITY-QUICKSTART.md) when friction is proven in M15.4 replay.

**Acceptance:** Documented operator journeys with before/after notes; targeted Console tests where behavior changes.

## M15.4 — Unified adoption acceptance

**Scope:**

- Single maintainer/CI-friendly harness (or documented script sequence) that replays:
  - [`examples/canonical-dependency-adoption`](../../examples/canonical-dependency-adoption/) (or `pnpm release:acceptance` subset)
  - Human-session Console smoke: login, Agent or declarative path, workflow publish optional, Testing Studio batch run optional
- Target artifact line: source-built **`1.1.0-rc.4`** image and/or published npm **`rc`** packages per [`../release/RC4_VERIFICATION.md`](../release/RC4_VERIFICATION.md) availability (PyPI/GHCR gaps documented until closed).

**Acceptance:** Secret-free summary doc (M10.4E-style) with migration head **`0030`**, integrity **`applied_and_matches`**, and resource IDs table.

## M15.5 — Production adoption closeout

**Scope:**

- [`../operations/M15_ACCEPTANCE_SUMMARY.md`](../operations/M15_ACCEPTANCE_SUMMARY.md) (create at closeout) + optional closeout summary.
- Update [`../release/COMPATIBILITY.md`](../release/COMPATIBILITY.md) and [`../release/RELEASE_CANDIDATE_INVENTORY.json`](../release/RELEASE_CANDIDATE_INVENTORY.json) when PyPI/GHCR/M10.4E replay completes.
- Residual risk register (Console CI gaps, unpublished channels, operator binding on approvals).

**Acceptance:** IMPLEMENTATION_TRACKER M15 slices marked complete with evidence; `pnpm verify:ci:clean` on merge-ready commit.

## Recommended M15.2 implementation order (next slice)

1. Read existing M13.7.4–M13.7.5 browser harness and evaluation run launch/detail components.
2. Add fixtures for priced vs unpriced model usage to force **INDETERMINATE** cost gate in UI.
3. Implement one Playwright file (for example `m15-2-evaluation-gate-browser.integration.test.ts`) covering launch + terminal detail.
4. Run `pnpm verify:branch` with Console integration obligations; update M13.7.5 acceptance doc to reference new coverage.

## Dependencies

- PostgreSQL migration head **`0030`** for full M14 approval binding and M13.7.5 gates.
- Human bootstrap (`pnpm identity:bootstrap`) for Console browser tests.
- Knowledge worker + embedding env for Knowledge Studio acceptance (existing M13.5 harness).
