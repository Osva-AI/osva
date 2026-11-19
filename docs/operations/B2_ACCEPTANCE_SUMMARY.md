# B2 — Model streaming and Console live output — acceptance summary

**Milestone:** B2 (B2.1–B2.4B)
**Branch (implementation):** `feat/aio-inference-optimization`
**Decision date:** 2026-11-18
**Verifier policy for this closeout:** Accept recorded evidence below. Do **not** treat incomplete `verify:branch` runs as failures. Branch **`LOCAL_PASS`** remains **pending** until consolidated B0–B4 PR readiness.

## Executive verdict

| Item | Status |
| --- | --- |
| Functional implementation (B2.1–B2.4B) | **COMPLETE** |
| Milestone acceptance for product slice | **ACCEPTED** (evidence-backed) |
| `pnpm verify:branch --profile=integration` **LOCAL_PASS** | **PENDING** |

B2 delivery is **accepted for review and consolidated PR readiness**. Formal branch gate completion is explicitly **deferred** alongside other branch-wide obligations (see below).

---

## Evidence matrix

| Area | Verdict | Evidence (representative) |
| --- | --- | --- |
| B2.1 Contracts and viewer projection | **PASS** | `packages/contracts` streaming + `run-live-stream` tests; fail-closed `projectModelStreamEventToViewer` |
| B2.2 Provider streaming | **PASS** | OpenAI / Anthropic / Gemini adapter stream integration tests (package-local) |
| B2.3 Worker IPC and MODEL RunStep accounting | **PASS** | `adapters/runtime-typescript` IPC tests; worker `model-stream-worker.integration.test.ts`; terminal RunStep unchanged vs sync path |
| B2.4A Valkey Pub/Sub + authenticated Web SSE | **PASS** | `apps/worker/test/integration/run-live-stream.integration.test.ts` (**5/5** in slice runs) |
| B2.4B Console BFF + client + UI | **PASS** | `run-live-stream-bff.test.ts`, `run-live-stream-client.test.ts`, `use-run-live-stream.test.tsx`, `run-detail-page.test.tsx`; `b2-streaming-bff-live.integration.test.ts` (**1/1**) |
| Real-stack Playwright (M12.3 harness) | **PASS 6/6** | `apps/console/test/integration/b2-streaming-browser.integration.test.ts` |
| Branch integration **LOCAL_PASS** | **PENDING** | Last `verify:branch --profile=integration` **aborted** during `@osva/console` unit tests after lint/typecheck passed; obligations not executed |
| Console unit-test shard (branch turbo) | **INCOMPLETE** | Same aborted run — **not** a recorded functional failure unless a specific test fails in isolation |

### Real-stack browser scenarios (A–F)

Harness: `startM12_3Infra` / `startM12_3HumanConsoleStack` (`m12-3-harness.ts`), `OSVA_RUN_LIVE_STREAM_ENABLED=true`, **`OSVA_RUN_LIVE_STREAM_TEXT_VISIBLE` unset (status-only default)**, fixture `model-stream-browser-hold-agent.ts` for attach timing.

| Scenario | Description | Result |
| --- | --- | --- |
| A | Authenticated live streaming via Console BFF (status-only) | **PASS** |
| B | Status-only: no model text / tool args in DOM | **PASS** |
| C | Navigation away: provider execution completes | **PASS** |
| D | Workspace isolation (API + UI) | **PASS** |
| E | Late attach / reload: no fabricated replay; gap note | **PASS** |
| F | Non-streaming terminal Run detail (live stream off) | **PASS** |

**Command (recorded green run):**

```text
pnpm --filter @osva/console build
pnpm --filter @osva/console exec vitest run --config vitest.integration.browser.config.ts test/integration/b2-streaming-browser.integration.test.ts
```

**Duration:** ~149s, **6 passed**.

### Cross-cutting fix (human session streaming)

`GET /v1/runs/:runId/stream` must resolve in the human access inventory as `GET /v1/runs/*/stream` (`stream` in `STATIC_V1_SEGMENTS`, `apps/web/src/v1-route-structural-key.ts`). Without this, Console human sessions received **403** on the live stream route while ordinary run read succeeded.

---

## Production text visibility and authorization

| Topic | Behavior |
| --- | --- |
| Default deployment | **Status-only** for viewers: `OSVA_RUN_LIVE_STREAM_TEXT_VISIBLE` unset/false on worker; Console shows safe progress, not token text |
| Trusted text | `OSVA_RUN_LIVE_STREAM_TEXT_VISIBLE=true` on **worker only** — deployment/trusted workload flag, not a Console user toggle |
| Limitation | **Broader per-viewer or per-workspace text authorization** (beyond trusted deployment flag) is **not** in B2; remains a documented product/security follow-up |

Viewer projection rules (no tool arguments, no usage leakage, bounded deltas) are unchanged from B2.4A contracts.

---

## Branch verification and deferred obligations

The following are **outstanding for consolidated B0–B4 PR / branch gate**, not blockers for accepting the B2 implementation slice:

| Obligation (from branch impact inventory) | Status at B2 closeout |
| --- | --- |
| `pnpm verify:branch --profile=integration` → **LOCAL_PASS** | **PENDING** (verifier never finished; no `artifacts/verification/branch-verification.json` from final run) |
| Worker runtime composition integration | **NOT RUN** in last branch attempt |
| Database integration | **NOT RUN** |
| Authentication isolation integration | **NOT RUN** |
| Console M16.3 browser acceptance | **NOT RUN** |
| Console browser smoke | **NOT RUN** |

**Do not** infer **LOCAL_PASS** from partial lint/typecheck/turbo unit success. Re-run the branch verifier only when explicitly approved for consolidated PR readiness.

### Incomplete Console unit shard (investigation rule only)

If a **specific** Console unit test fails or hangs in the future:

- Run the **smallest** command (e.g. single file under `apps/console/test/`) with a **bounded** deadline.
- Do **not** re-run full `verify:branch`, full Console matrix, or successful B2 browser/BFF tests as part of B2 closeout.

---

## Architecture reference

- Contracts and slices: [`docs/implementation/B2_1_MODEL_STREAMING_FOUNDATION.md`](../implementation/B2_1_MODEL_STREAMING_FOUNDATION.md)
- Target inference architecture: [`docs/architecture/AI_INFERENCE_OPTIMIZATION.md`](../architecture/AI_INFERENCE_OPTIMIZATION.md)
- Branch gate semantics: [`docs/engineering/BRANCH_VERIFICATION.md`](../engineering/BRANCH_VERIFICATION.md)

---

## B3 prerequisites (informational only — not started)

- Consolidated branch **LOCAL_PASS** and integration obligations above
- Explicit decision on viewer text policy beyond deployment-level `OSVA_RUN_LIVE_STREAM_TEXT_VISIBLE`
- Any B3 scope items defined in the inference optimization roadmap after B2 sign-off

---

## Git / GitHub

No commits, pushes, or PR actions performed as part of this acceptance documentation update.
