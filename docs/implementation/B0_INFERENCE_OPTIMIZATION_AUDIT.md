# B0 — AI Inference Optimization Audit

Status: **B0 architecture audit** (read-only; source-verified 2026-11-18).

Branch at audit time: `feat/aio-inference-optimization` (expected name in brief: `feat/aio-inference-optimization-b0` — naming mismatch only; no branch mutations performed).

## 1. Executive summary

OSVA has a **production-grade synchronous ModelGateway** with OpenAI, Anthropic, and Gemini adapters, workspace-scoped provider connections, normalized token usage (including provider cache read/write), RunStep persistence, and tiered cost estimation. **Response caching, streaming, provider batch APIs, and intelligent routing are not implemented.** LiteLLM is supported only as an **optional OpenAI-compatible base URL** on connections, not as an OSVA dependency. Valkey is already deployed for BullMQ and HTTP rate limiting and is the natural home for an exact-response cache. Evaluation A1–A5 provides quality measurement suitable for **routing recommendations**, not automatic policy mutation.

**Recommended sequence:** B1 (caching + accounting provenance) → B2 (streaming) → B3 (provider batch) → B4 (routing).

## 2. Source inventory

### 2.1 Model Gateway (`packages/model-gateway/`)

| Area | Evidence | Notes |
| --- | --- | --- |
| Public port | `packages/contracts/src/model-gateway.ts` | `generateText`, `generateCompletion`; no streaming |
| Implementation | `packages/model-gateway/src/model-gateway.ts` | Loads `ModelProfileVersion`, resolves adapter |
| Adapter contract | `packages/model-gateway/src/provider-adapter.ts` | `ResolvedProviderGenerateTextRequest` + `AbortSignal` |
| Usage normalization | `packages/model-gateway/src/usage.ts` | `cachedInputTokens`, `cacheWriteInputTokens`, `incomplete` |
| Errors | `packages/model-gateway/src/errors.ts` | `ModelGatewayError`, retryable flag |
| Provider metadata | `packages/model-gateway/src/provider-invocation.ts` | configured vs reported model id |
| Tests | `packages/model-gateway/test/` | Routing to adapter, usage types |

**Incomplete vs contracts:** `ModelRequest` / `invoke()` in contracts are **not implemented** (documented as future surface).

### 2.2 Provider adapters

| Adapter | SDK / transport | Streaming in SDK | Exposed to OSVA | Cache usage accounting | AbortSignal |
| --- | --- | --- | --- | --- | --- |
| OpenAI | `openai` Responses + Chat Completions | Yes (SDK) | **No** — non-streaming only | `cached_tokens` in usage (`openai-usage.ts`) | Yes |
| Anthropic | `@anthropic-ai/sdk` Messages | Yes (SDK) | **No** | `cache_read_input_tokens`, `cache_creation_input_tokens` | Yes |
| Gemini | `fetch` generateContent | Yes (API) | **No** | `cachedContentTokenCount` (`gemini-usage.ts`) | Yes (`fetchWithSignal`) |

**Prompt cache breakpoints:** Anthropic `buildAnthropicMessagesCreateBody` does **not** set `cache_control`. OpenAI/Gemini adapters do **not** send explicit cache TTL/prefix hints. Provider-native caching is **passive** (provider may cache; OSVA records usage when returned).

**Retries:** OpenAI legacy env adapter allows SDK `maxRetries: 2`; **connection-resolved** adapters use `OPENAI_CONNECTION_RESOLVED_MAX_RETRIES = 0`. Anthropic connection uses `ANTHROPIC_SDK_MAX_RETRIES = 0`. Comment in `openai-provider-adapter.ts` states OSVA does not add gateway-level fallback.

**Batch APIs:** No references in `adapters/model-*`.

### 2.3 Connection resolution

- `adapters/model-provider-connectivity/src/model-provider-connection-resolver.ts`
- Workspace-scoped connection + version validation
- `createPinnedOutboundFetch` + `evaluateRemoteHttpDestination` for SSRF policy
- Test timeout 15s; generate timeout 120s on connections
- LiteLLM-style: custom `baseURL` on OpenAI connection (`apps/worker/test/integration/model-gateway.integration.test.ts`)

### 2.4 Execution plane

| Component | Role | Evidence |
| --- | --- | --- |
| `packages/orchestration/src/execute-run-attempt.ts` | RunAttempt lifecycle, lease, cancel | `executionGeneration`, `signalRuntimeCancellation` |
| `packages/observability/src/run-step-recorder.ts` | MODEL RunSteps, wraps ModelGateway | `generateTextOutcome`, `generateCompletionOutcome` |
| `packages/observability/src/model-run-step-finalize.ts` | Usage + cost on finalize | `estimateModelCostUsdMicros` |
| `apps/worker/src/process.ts` | Wires gateway + connection resolver | |
| `adapters/bullmq/` | Queue transport | Job payload `{ runAttemptId }` |
| `adapters/runtime-http/src/capability-bridge.ts` | Remote runtime model calls | **generateText only** (no generateCompletion path) |

**Generation fencing:** `executionGeneration` on RunAttempt with lease renewal (`execute-run-attempt.ts`).

**Cancellation:** RunAttempt-level cancel signals runtime; model `AbortSignal` passed through recorder when options supplied (caller-dependent).

### 2.5 Persistence (`packages/db/`)

- `run_steps` schema via `packages/contracts/src/schemas/run-step.ts`: token fields, `cachedInputTokens`, `cacheWriteInputTokens`, `usageIncomplete`, `providerReportedModelId`, `providerRequestId`, `estimatedCostUsdMicros`
- `PostgresRunRepository` measurable model step SQL
- Model profiles, provider connections repositories (M12 era)
- **No** inference cache or batch job tables

### 2.6 Interfaces

- REST: model profiles, connections (`docs/contracts/REST_API_V1.md`)
- SDK mirrors contracts
- Console: model connection UI with LiteLLM placeholder URL
- Runtime protocol: `generateText` capability; structured agent loops use in-process `generateCompletion` for declarative/trusted runtimes

### 2.7 Evaluation (A1–A5)

| Slice | Doc | Reuse for optimization |
| --- | --- | --- |
| A1 | `A1_DETERMINISTIC_EVALUATORS.md` | Latency-free quality baselines |
| A2 | `A2_DURABLE_EVALUATION.md` | Coordinator pattern |
| A3 | `A3_LLM_JUDGE.md` | Judge RunSteps + accounting (`evaluation-judge-accounting.ts`) |
| A4 | `A4_RAG_AND_SEMANTIC_EVALUATION.md` | RAG metrics; **not** inference semantic cache |
| A5 | `A5_PAIRWISE_REGRESSION_HUMAN_CALIBRATION.md` | Regression/promotion evidence for routing **recommendations** |

Judge/pairwise recovery: `packages/orchestration/src/judge-task-recovery-coordinator.ts` (BullMQ batches, not provider batch).

## 3. Current capability matrix

| Capability | Status | File evidence | Production readiness | Known limitations | Required extension | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| Provider-native caching (usage) | **IMPLEMENTED** | `*-usage.ts`, run-step schema | Production | No explicit cache breakpoints in requests | Optional cache_control / OpenAI cache hints in adapters | B1: passive + optional active hints behind policy |
| Exact-response caching | **NOT IMPLEMENTED** | — | — | — | Valkey cache port + key canonicalization | B1 |
| Semantic caching | **NOT IMPLEMENTED** | — | — | — | Embeddings + similarity gate | Defer; evidence required |
| Prompt-prefix reuse | **PARTIAL** | Message split only (`messages.ts`) | Production for structure | No provider cache markers | Adapter-level prefix stabilization | B1 optional |
| Streaming text | **NOT IMPLEMENTED** | Adapters use non-stream APIs | — | SDK supports stream | Streaming adapter + contract | B2 |
| Streaming tool calls | **NOT IMPLEMENTED** | — | — | — | Event multiplexing | B2 |
| Streaming cancellation | **PARTIAL** | `AbortSignal` on adapters | Production | No streaming client path | Link cancel to stream close | B2 |
| Incremental usage | **NOT IMPLEMENTED** | Terminal usage only | — | — | Stream `usage_preview` optional | B2 |
| Provider batch jobs | **NOT IMPLEMENTED** | — | — | — | Batch port + persistence | B3 |
| Internal async execution | **IMPLEMENTED** | BullMQ, evaluation/judge coordinators | Production | Not provider batch | Reuse for poll/reconcile | B3 orchestration |
| Rate-limit awareness (HTTP) | **IMPLEMENTED** | `ValkeyFixedWindowRateLimiter` | Production | Not per-provider quota | Optional provider 429 backoff in adapters (exists partially in Gemini errors) | Harden in B4 |
| Model routing | **PARTIAL** | Static `ModelProfileVersion` binding | Production | No fallback/ranking | `InferenceRouter` + policy version | B4 |
| Fallbacks | **NOT IMPLEMENTED** | Explicit comment OpenAI adapter | — | — | Policy-ordered list | B4 |
| Provider health tracking | **NOT IMPLEMENTED** | OTLP metrics counters | Partial metrics | No health store | Aggregate RunStep errors | B4 |
| Quality-based selection | **PARTIAL** | A5 assessments | Evaluation only | Not wired to runs | Read-only recommendation API | B4 |
| Cost-based selection | **NOT IMPLEMENTED** | `estimateModelCostUsdMicros` | Step-level only | No run budget | Policy max + cheapest eligible | B4 |
| Latency-based selection | **PARTIAL** | `MODEL_DURATION_MS` histogram | Observability | No router | p95 from metrics store | B4 |
| Model budget enforcement | **NOT IMPLEMENTED** | — | — | — | Workspace budget policy | B4 / later |
| Evaluation-driven optimization | **PARTIAL** | A1–A5 | Evaluation plane | No auto production change | Human-approved policy publish | B4 |

## 4. Build-versus-reuse assessment

### 4.1 LiteLLM

| Criterion | Assessment |
| --- | --- |
| Provider routing / fallbacks | LiteLLM provides; **overlaps** OSVA ModelProfile + future InferenceRouter |
| Response / semantic cache | LiteLLM has Redis cache; **overlaps** proposed OSVA Valkey cache (workspace authority in OSVA) |
| Usage accounting | LiteLLM logs usage; **conflicts** with RunStep canonical accounting unless proxied per call |
| Virtual keys | Overlaps workspace API keys + connection secrets |
| Deployment | Separate Python proxy + HA; operational burden |
| TypeScript | No first-class TS library; HTTP OpenAI shim only |
| License | Apache 2.0 (compatible) |

**Overlap resolution:**

| Concern | OSVA owner today | LiteLLM if adopted |
| --- | --- | --- |
| Model profiles | PostgreSQL immutable versions | Would duplicate |
| Credentials | Connection versions + SecretResolver | Virtual keys duplicate |
| Workspace isolation | Repository queries | Must not trust proxy alone |
| Billing | RunStep + pricing on profile | Would need reconciliation |
| Retry ownership | Disabled per connection | Proxy retries risk double count |
| Observability | RunStep + OTLP | Needs correlation |

**Decision (PROPOSED):** **D — Reference implementation only** for OpenAI-compatible operator deployments; **C — Optional OpenAI-compatible gateway** via existing `ModelProviderConnection` `baseURL` (already tested). **Not** (A) required dependency. **Not** (E) rejected for self-hosted gateways.

### 4.2 Vercel AI SDK (`ai` / `@ai-sdk/*`)

- Not present in `package.json` (verified).
- Would duplicate three mature adapters and error normalization.
- Streaming/tool helpers are valuable but require contract overhaul.

**Decision (PROPOSED):** **E — Rejected for current scope** as adapter replacement. Revisit selective **stream parser utilities** only if B2 implementation cost proves high (optional spike in B2 slice 1).

### 4.3 Valkey

- Already used: BullMQ (`OSVA_VALKEY_URL`), HTTP rate limits (`apps/web/src/process.ts`).
- Suitable for exact-response cache, TTL, single-flight locks, workspace key prefixes.

**Decision (PROPOSED):** **Reuse** for B1/B3 coordination; no second Redis-compatible product.

### 4.4 BullMQ

- Canonical Run transport and evaluation/judge recovery batches.

**Decision:** **Reuse**; do not introduce competing queue. Provider batch polling can use scheduled worker ticks or dedicated low-priority queue on same BullMQ/Valkey.

### 4.5 Provider-native APIs (summary)

| Provider | Prompt cache | Streaming | Batch API | Usage notes |
| --- | --- | --- | --- | --- |
| **OpenAI** | Automatic prompt caching on supported models; `cached_tokens` in usage | Responses + Chat stream | Batch API for async JSONL jobs | Responses default for simple text; chat for tools/JSON |
| **Anthropic** | `cache_control` breakpoints | Messages stream | Message Batches API (documented) | Cache read/write token fields |
| **Gemini** | Context caching (API evolution) | `streamGenerateContent` | Batch prediction (Vertex/Gemini batch endpoints) | `cachedContentTokenCount` |

OSVA implements **synchronous non-batch, non-stream** subset uniformly.

## 5. Security and accounting audit (per feature)

| Control | B1 cache | B2 stream | B3 batch | B4 route |
| --- | --- | --- | --- | --- |
| Workspace isolation | Key prefix + authz on read | Stream scoped to run/workspace | Batch entity workspaceId | Policy workspace-scoped |
| Cache hit ≠ provider call | Required | N/A | N/A | N/A |
| Provider prompt cache = invocation | Yes | Yes | Yes | Yes |
| Unknown cost | Null estimate | Terminal usage required | Per-item usage reconcile | Exclude unpriced from "cheapest" |
| Secret redaction | No secrets in keys | No delta leakage of secrets | Artifact refs not inline secrets | Audit log redaction |
| Idempotency | Cache put once per key | RunStep single terminal | Provider submission idempotency key | Deterministic policy hash |

## 6. Benchmark methodology (B1–B4)

**Baselines (measure before each milestone):**

- Median/p95 end-to-end Run duration (model-only micro-benchmark agent)
- Time to first token (B2+)
- Provider invocation count per Run
- RunStep `estimatedCostUsdMicros` sum vs priced calls
- Cache lookup latency (B1+)
- Evaluation suite scores (existing A fixtures)

**Targets (set per workspace in pilot; not invented here):**

- Document % cache hit rate goals after B1 pilot
- Stream disconnect completion rate = 100% terminal RunSteps

**CI:** deterministic fake providers (`adapters/model-*/test/fake-*-server.ts`, worker integration). Real provider probes: operator-only, budget-capped.

## 7. Proposed B1–B4 slices

### B1 — Caching

| Slice | Objective | Packages | Persistence | Acceptance |
| --- | --- | --- | --- | --- |
| B1.1 | Cache identity, eligibility policy, `ExactResponseCachePort` (no Valkey adapter yet) | `packages/contracts`, `packages/domain/src/inference-cache/` | None | Unit: key stability, workspace isolation, default disabled |
| B1.2 | Valkey `ExactResponseCachePort` adapter | `adapters/inference-cache-valkey` | Valkey entries (plaintext; test/dev) | Unit + Valkey integration |
| B1.3 | `CachingModelGateway` + RunStep provenance (`model_invocation_source`) | `model-gateway`, `observability`, `worker` inject, `db` `0039` | `run_steps` columns | Fake provider + recorder tests; worker injects cache in hermetic runs only |
| B1.4 (future) | Workspace cache policy CRUD / production enablement gates | `web`, `domain`, encryption | `cache_policies` (proposed) | Authz deny cross-workspace |
| B1.4 | Anthropic/OpenAI optional cache hints | `adapters/model-*` | — | Usage shows cache read increase in fake tests |

**Risks:** Stochastic caching; tool-loop eligibility bugs.

### B2 — Streaming

| Slice | Objective | Packages | Persistence | Acceptance |
| --- | --- | --- | --- | --- |
| B2.1 | Internal `ModelStreamEvent` contract + terminal assembler | `contracts` | — | **Done** — assembler/schema unit tests (no live providers) |
| B2.2 | Provider streaming + ModelGateway `generateCompletionStream` | `model-gateway`, `adapters/model-*` | — | **Done** — fake SSE servers + assembler parity tests (no live APIs) |
| B2.3 | Recorder terminal finalize on stream complete | `observability` | RunStep unchanged shape | Cancel mid-stream still finalizes usage |
| B2.4 | Console/SSE presentation (optional) | `web`, `console` | Ephemeral buffer | Manual UX acceptance |

**Risks:** Remote HTTP runtime still synchronous unless protocol extended.

### B3 — Batch

| Slice | Objective | Packages | Persistence | Acceptance |
| --- | --- | --- | --- | --- |
| B3.1 | Portable batch contracts + state machine + correlation | `contracts` (+ design doc) | — (proposed schema in [B3_1](./B3_1_BATCH_INFERENCE_FOUNDATION.md)) | **Done** — focused contract unit tests |
| B3.2 | OpenAI batch submit/poll adapter | `adapters/model-openai` | Snapshots | Fake batch API |
| B3.3 | Worker reconcile tick + `BatchInferenceJob` table | `orchestration`, `worker`, `db` | Status transitions | Crash recovery test |
| B3.4 | Usage + cost per output line + submit dedup | `domain` model-cost | Batch line items | No fabricated zeros |

**Risks:** Partial batch failures; pricing differences vs sync API.

### B4 — Routing

| Slice | Objective | Packages | Persistence | Acceptance |
| --- | --- | --- | --- | --- |
| B4.1 | `RoutingPolicyVersion` immutable + `RoutingModelGateway` | `domain`, `db`, `web`, `model-gateway` | Migration `0043` | Default-off; contracts/domain/gateway tests; worker policy inject |
| B4.2 | Static + fallback router | `model-gateway` or new `inference-routing` package | — | Deterministic tests |
| B4.3 | Cost/latency eligible selection | Uses RunStep aggregates | Read models | Cheapest only when priced |
| B4.4 | Eval recommendation import (read-only) | `web` API from A5 artifacts | — | Cannot mutate bindings without publish |

**Risks:** Automatic substitution; benchmark staleness.

## 8. File impact estimates (order of magnitude)

| Milestone | New/changed files (estimate) |
| --- | --- |
| B1 | 25–40 (adapter, gateway, db migration, web policy CRUD) |
| B2 | 30–50 (adapters x3, observability, optional web SSE) |
| B3 | 35–55 (schema, openai batch, orchestration tick) |
| B4 | 25–45 (policy domain, router, console) |

## 9. Verification strategy (B1+)

Per `docs/engineering/OSVA_VERIFICATION_STRATEGY.md`:

- `pnpm verify:quick` during slices
- `pnpm verify:ci:clean` once per milestone merge
- Targeted `apps/worker` model-gateway integration tests extended per slice
- Prettier on all changed files; `node scripts/release/docs-link-check.mjs` for docs

**B0 only:** read-only audit + doc artifacts (this file).

## 10. Risks and open questions

1. **Stochastic agent caching** — policy default deny sufficient?
2. **Tool-loop cache boundaries** — per-completion vs per-run?
3. **Remote HTTP generateCompletion** — protocol gap for declarative agents on remote runtime.
4. **Provider batch vs evaluation throughput** — when to use which?
5. **LiteLLM in enterprise** — remain optional connection only?
6. **Encryption at rest** for cache values — workspace KMS story undefined.

## 11. Dependency impact

| Dependency | B0 action |
| --- | --- |
| `openai`, `@anthropic-ai/sdk` | Keep; extend for stream/batch in place |
| Valkey client (existing) | Reuse |
| LiteLLM | None (operator-hosted) |
| Vercel AI SDK | None |
| New | Possibly none in B1 except tests |

## 12. Documentation consistency

Architecture overview Stage 2.8 model gateway scope remains accurate; this track extends Stage 3+ inference optimization without changing Run lifecycle invariants in `AGENTS.md`.