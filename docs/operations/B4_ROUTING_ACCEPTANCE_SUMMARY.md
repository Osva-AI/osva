# B4 Routing Operational Acceptance Summary

## Status

**B4 FUNCTIONALLY COMPLETE** for this slice. Focused worker routing integration `inference-routing.integration.test.ts` is **11/11 pass** (R1–R12). Consolidated B0–B4 branch verification and production release sign-off are **out of scope** for this document.

## Provider attempt accounting

- Wrapper order per execution: `RunStepRecorder → RoutingModelGateway → CachingModelGateway → ModelGateway`.
- Each routed provider attempt flows through the inner stack; `RoutingModelGateway` records attempts on `InferenceRoutingDecisionRecordV1.attempts`.
- `onProviderAttempt` on `ModelGatewayRoutingContext` notifies observability; `MODEL_CALLS` metrics are recorded per real provider round-trip (skipping OSVA exact-response cache hits and avoiding double-count on the final RunStep success path).
- One MODEL `RunStep` remains per logical runtime model call; per-attempt detail is authoritative on the routing decision record (not multiple RunSteps per fallback).
- Failed-attempt provider usage is retained when the provider reports it; the fake OpenAI adapter does not fabricate usage on hard failures.

## Decision persistence reliability

**Best-effort operational trace.** Worker `persistDecision` failures are logged (`worker.inference_routing_decision_persist_failed`) and do not fail the Run. Streaming invocations now persist routing decisions after the stream completes (success or failure). Do not claim every routed invocation always has a durable decision without monitoring that log.

## Policy circuit breaker

- Worker resolves `InferenceRoutingCircuitBreakerRegistry` per **workspace + active `policyVersionId`** via `InferenceRoutingCircuitBreakerStore` (`apps/worker/src/process.ts`).
- Validated `definition.circuitBreaker` from the trusted runtime policy is applied at registry creation; invalid config rejects at resolve time.
- Breaker observations use the same **connection-version identity** as eligibility checks (`RoutingModelGateway` passes `connectionVersionId` on observe).
- State is **per worker process** and reset when a new policy version is activated (fresh registry). **Cross-worker Valkey coordination is not implemented.**

## Soft budget

`maxEstimatedCostUsdMicros` is a **soft preflight gate** only (R6). Hard atomic workspace budgets remain deferred.

## Evidence ledger

| Check | Command | Result |
| --- | --- | --- |
| Circuit breaker store | `pnpm --filter @osva/domain exec vitest run test/inference-routing/circuit-breaker-store.test.ts` | **3/3 pass** |
| RoutingModelGateway | `pnpm --filter @osva/model-gateway exec vitest run test/routing-model-gateway.test.ts` | **4/4 pass** |
| Worker R1–R12 | `pnpm --filter @osva/worker run test:integration -- test/integration/inference-routing.integration.test.ts` | **11/11 pass** |
| Routing contracts | `pnpm --filter @osva-ai/contracts exec vitest run test/inference-routing.test.ts` | Pass (prior) |
| Domain selection + circuit | `pnpm --filter @osva/domain exec vitest run test/inference-routing.test.ts` | Pass (prior) |
| Migration 0043 | `pnpm --filter @osva/db run test:integration -t 0043` | Pass (prior) |

Use **exact** Vitest titles when isolating scenarios (e.g. `-t "R1: routing disabled leaves decision table empty"`). Broad filters like `-t "R1"` also match R10–R12.

## Worker scenario table (R1–R12)

| Scenario | Status | Evidence |
| --- | --- | --- |
| R1 Routing disabled | **Pass** | Zero `inference_routing_decisions` rows |
| R2 Fixed policy | **Pass** | Provider model + persisted decision |
| R3 Cost selection | **Pass** | Cheaper candidate selected |
| R4 Retryable fallback | **Pass** | Two provider models; `providerAttemptCount: 2`; attempt outcomes `FAILED` → `SUCCEEDED` |
| R5 Unauthorized candidate | **Pass** | Zero provider calls; run `FAILED` |
| R6 Budget preflight | **Pass** | Zero provider calls; run `FAILED` |
| R7 Streaming + routing | **Pass** | Routed `gpt-test-snapshot`, deltas, one MODEL step, decision persisted |
| R8 Stream fail no model switch | **Pass** | Mid-stream fail; fallback model never called |
| R9 Valkey cache isolation | **Pass** | A/B each invoked once; repeat hits `OSVA_RESPONSE_CACHE_HIT`; encrypted Valkey wire; re-activate policy A restores A cache |
| R10 Policy circuit breaker | **Pass** | Threshold 2 opens; third run uses cheap only |
| R11 Decision API | **Pass** | With R2 |
| R12 Compatibility | **Pass** | Routing off uses bound `gpt-routing-test` |

## Deferred limitations (explicit)

| Capability | Status |
| --- | --- |
| Hard atomic workspace budget | **NOT IMPLEMENTED** |
| Cross-worker circuit breaker | Per-worker memory only |
| Postgres-backed latency aggregates | In-worker rolling store |
| A5 quality auto-ranking | Not in hot path |
| Streaming fallback before/after emission | **Unavailable** — routing selects one model before `generateCompletionStream` (R8) |
| Consolidated B0–B4 `verify:ci:clean` | **Not run** in this slice |

## Enablement / rollback

Activate via `POST /v1/inference-routing-policies/activate`; disable with `{ enabled: false }`.

## Git safety

No AI git/GitHub writes in this pass (`git diff --check` clean).