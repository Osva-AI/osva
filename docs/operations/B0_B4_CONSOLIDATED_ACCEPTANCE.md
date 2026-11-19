# B0–B4 Consolidated Operational Acceptance

**Branch:** `feat/aio-inference-optimization`
**Release-readiness audit date:** 2026-11-19
**Verdict:** See §1 (human PR gate still pending fresh `verify:branch` after fixes + commit)

## 1. Executive summary

| Track | Functional slice | Recorded acceptance |
| --- | --- | --- |
| B0 | Architecture / audit / ADR-012 | **Complete** (planning); see `docs/architecture/AI_INFERENCE_OPTIMIZATION.md`, ADR-012 |
| B1 | Encrypted Valkey exact-response cache | **Complete** — B1.4 ops + worker/cache integration |
| B2 | Model streaming + Console live output | **Complete** — Playwright **6/6** |
| B3 | Native batch inference | **Complete** — worker integration **15/15** |
| B4 | Intelligent routing | **Complete** — worker routing **11/11** |

**Branch `LOCAL_PASS`:** Not claimed on this audit pass. Latest `pnpm verify:branch -- --profile=integration` run **failed at LINT** (`@osva/orchestration` restricted imports); fixes were applied but the **full gate was not re-run** per release-readiness rules. A prior `artifacts/verification/branch-verification.json` may show `LOCAL_PASS` — treat as **stale** until re-verified on the committed changeset.

**Git state:** `HEAD` is **identical to `origin/main`** (`753600d49aa8a7e8dd812b076bce68919bc16964`). B0–B4 implementation is primarily **uncommitted working-tree** (~248 paths). Human operator must **stage and commit** before PR.

**External playbook:** `ENGINEERING_VERIFICATION_PLAYBOOK.md` is **not** in the repository; use `docs/engineering/OSVA_VERIFICATION_STRATEGY.md` and `scripts/verification/branch-verify.mjs`.

## 2. Scope delivered

- **B1:** `ValkeyExactResponseCache`, AES-GCM wire protection, canonical cache identity, `modelInvocationSource`, workspace trusted cache policy (default off).
- **B2:** Provider streaming, runtime IPC streaming, live run stream (Valkey), authenticated SSE, Console BFF + UI, status-only default.
- **B3:** Batch jobs/items (migrations 0041–0042), provider batch adapters, worker reconciliation, REST batch routes, workspace batch policy (default off).
- **B4:** Routing policies/decisions (migration 0043), `RoutingModelGateway`, circuit breaker store, worker R1–R12 harness.

## 3. Evidence matrix

| Milestone | Capability | Impl. | Focused test / command | Count | Last evidence | Outstanding | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B0 | Architecture | Done | ADR-012, audit doc | — | Read-only audit | Refresh B0 audit “not implemented” wording (historical) | P3 |
| B1 | Exact-response cache | Done | `exact-response-cache.integration.test.ts`, Valkey adapter tests | Prior pass | Recorded B1.4 | None for slice | Low |
| B2 | Streaming stack | Done | `model-stream-worker.integration.test.ts`, `run-live-stream.integration.test.ts` | Prior pass | B2 summary | None for slice | Low |
| B2 | Console browser | Done | `b2-streaming-browser.integration.test.ts` | **6/6** | 2026-11-18 ~149s | Do not rerun unless regressions | Low |
| B3 | Batch worker | Done | `batch-inference-openai.integration.test.ts` | **15/15** | Prior slice | Re-run only if batch worker wiring changes | Medium |
| B4 | Routing worker | Done | `inference-routing.integration.test.ts` | **11/11** | 2026-11-19 ~47s | None for slice | Low |
| Branch | Integration gate | Partial | `pnpm verify:branch -- --profile=integration` | — | **FAIL LINT** this audit | **Re-run after commit** | High |
| CI | Clean matrix | Not run | `pnpm verify:ci:clean` | — | Hosted only | **Human PR CI** | Medium |

### This audit (additional direct runs)

| Check | Command | Result |
| --- | --- | --- |
| Migration manifest | `pnpm db:migrations:verify` | **PASS** (through `0043_inference_routing_slice`) |
| Migration acceptance | `pnpm --filter @osva/db run test:integration -- … -t "0039\|0040\|0043"` | **3 passed** (explicit titles) |
| Migration 0040 | `-t "0040"` | **1 passed** |
| Web routes/auth | `v1-route-inventory`, `v1-route-authorization-policy`, `auth-http` | **14/14** |
| Console unit (sample) | `server.test.ts`, `run-live-stream-bff.test.ts` | **46/46** |
| Docs links | `node scripts/release/docs-link-check.mjs` | **PASS** (224 files) |
| Worker typecheck | `pnpm --filter @osva/worker run typecheck` | **PASS** (after `RoutingModelGatewayInner` fix) |
| `git diff --check` | — | **PASS** |

## 4. Migrations (0039–0043)

| Tag | Purpose |
| --- | --- |
| `0039_run_step_model_invocation_source` | RunStep provenance / cache-hit accounting |
| `0040_workspace_inference_cache_policy` | Workspace cache policy rows |
| `0041_batch_inference_slice` | Batch jobs/items core |
| `0042_batch_inference_completion_b` | Pricing snapshot, completion fields |
| `0043_inference_routing_slice` | Routing policies, versions, activation, decisions |

**Integrity:** `pnpm db:migrations:verify` + `pnpm db:migrations:integrity` (branch verifier). Journal/manifest SHA locked. Fresh install and upgrade paths covered by `@osva/db` migration acceptance suite (Docker Postgres test harness; no ambient `OSVA_DATABASE_URL` required for harness tests).

## 5. REST and authorization

New / extended V1 surfaces (inventories updated in `apps/web`):

| Area | Routes module | Default policy |
| --- | --- | --- |
| B2 live stream | `run-live-stream-http.ts`, `GET /v1/runs/:runId/stream` | Authenticated; human inventory includes `*/stream` structural key |
| B3 batch | `batch-inference-http.ts` | API key + workspace scope; batch policy **off** until upsert |
| B4 routing | `inference-routing-http.ts` | Policy CRUD + activate + decision GET; routing **off** until activate |

**Evidence:** `apps/web/test/v1-route-inventory.test.ts`, `v1-route-authorization-policy.test.ts`, `auth-http.test.ts` — **14/14** this audit. Cross-workspace isolation remains **404/deny** baseline.

## 6. Execution stack (cross-track)

```text
RunStepRecorder.wrap(
  RoutingModelGateway(
    CachingModelGateway(
      ModelGateway
    )
  )
)
```

| Interaction | Expected behavior | Evidence |
| --- | --- | --- |
| B1 + B2 | Cache eligibility does not apply to streaming path same as sync; stream bypasses cache where policy requires | B2 stream integration; cache domain tests |
| B1 + B4 | Routing selects model **before** cache identity; R9 Valkey isolation | B4 R9 **11/11** suite |
| B2 + B4 | Routed streaming; no post-delta model fallback | B4 R7/R8 |
| B3 + B4 | Batch submission explicit; no routing mutation of batch jobs | Separate orchestration paths |
| Secrets | References only in persistence | Existing OSVA secret resolver patterns |
| Eval / judge | Routing skipped | `execution.evaluationContext` worker wiring |

## 7. Configuration (default-off)

| Feature | Enable |
| --- | --- |
| Exact-response cache | Worker/cache port injection + workspace trusted cache policy |
| Live stream | `OSVA_RUN_LIVE_STREAM_ENABLED` (worker); text via `OSVA_RUN_LIVE_STREAM_TEXT_VISIBLE` |
| Batch inference | Workspace batch policy upsert (no public enable-only HTTP in slice) |
| Routing | `POST /v1/inference-routing-policies/activate` with `enabled: true` |

## 8. Known limitations (P2 — intentional)

- Hard **atomic** workspace budget: **not implemented** (B4 soft preflight only).
- **Cross-worker** circuit breaker: per-process memory only.
- **Quality auto-ranking** for routing: not in hot path.
- **Public** batch policy-enable API: not implemented.
- **Ambiguous** batch submission recovery: operator intervention; no auto-resubmit.
- **Streaming fallback** after partial output: **prohibited** (R8).
- Routing decision persistence: **best-effort** (`worker.inference_routing_decision_persist_failed`).
- B2 viewer text: deployment flag only; no per-viewer workspace text ACL in B2.
- Batch output size / retention: PostgreSQL JSON limits; provider file cleanup operator-owned (see B3 ops doc).

## 9. Release-blockers addressed this audit (P1)

| Issue | Resolution |
| --- | --- |
| Worker typecheck: `CachingModelGateway` not assignable to routing inner | `RoutingModelGatewayInner` union type in `@osva/model-gateway` |
| `@osva/orchestration` lint: adapter imports forbidden | Moved `createBatchInferenceProviderAdapter` to `apps/worker/src/batch-inference-adapter-factory.ts` |
| Worker lint: unused imports in batch integration test | Removed |

## 10. Upgrade and rollback

- Apply migrations **0039–0043** before enabling new features.
- Rollback: disable policies (`routing activate enabled:false`, omit cache port, disable live stream env); batch jobs remain in terminal states; cache keys in Valkey are ephemeral per TTL.
- No destructive migration rollback scripts in slice.

## 11. Package / release impact

- New packages: `@osva/adapters-inference-cache-valkey`, `@osva/adapters-run-live-stream-valkey`.
- Contract expansions: inference cache, streaming, batch, routing, run-live-stream schemas.
- **Do not publish** from this audit; version bumps are human PR/CI decisions.

## 12. Human PR checklist

1. Review **248** changed/untracked paths; commit in sensible slice(s) on `feat/aio-inference-optimization` (or rename per team convention).
2. Re-run **`pnpm verify:branch -- --profile=integration`** until **`verify:branch LOCAL_PASS`** and fresh `artifacts/verification/branch-verification.json`.
3. Open PR; ensure hosted **`verify:ci:clean`** (or repo default CI) passes.
4. Confirm Valkey + migration rollout notes in deploy docs for operators.

## 13. Git safety

No AI git commit, push, branch switch, or PR operations in this audit.
