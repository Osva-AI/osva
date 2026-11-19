# ADR-012: AI Inference Optimization Architecture

**Status:** PROPOSED (B0 design milestone; pending architecture review)

**Date:** 2026-11-18

## Context

OSVA executes model calls through `ModelGateway`, immutable `ModelProfileVersion` bindings on Runs, provider adapters (OpenAI, Anthropic, Gemini), and durable `RunStep` accounting. Advanced Evaluation A1–A5 is merged. The next track adds caching, streaming, batch inference, and intelligent routing without duplicating lifecycle authority or workspace isolation.

Constraints from `AGENTS.md`:

- Model calls are mediated by ModelGateway.
- PostgreSQL is canonical lifecycle/state authority.
- BullMQ is transport, not lifecycle authority.
- Provider SDK objects never enter domain contracts.

## Decision

Adopt a **layered optimization architecture** owned by OSVA, integrated at the ModelGateway boundary and `RunStepRecorder`, with optional Valkey for exact-response cache and single-flight, BullMQ for internal reconciliation work, and Evaluation artifacts for **read-only** routing guidance.

### 1. Caching

- **Provider-native prompt caching:** Continue treating provider invocations as billable model calls; persist `cachedInputTokens` and `cacheWriteInputTokens` on RunSteps (already implemented). Optionally add provider-specific cache hints in adapters behind workspace **CachePolicy** (default: passive).
- **Exact-response caching:** Implement workspace-scoped, optional exact-response cache in Valkey with canonical hashed keys. **Cache hit must not increment provider invocation counts** and must not record `providerRequestId`.
- **Semantic caching:** Not enabled by default; any future pilot requires documented false-match risk analysis and privacy review.
- **Single-flight:** Optional Valkey-coordinated deduplication separate from durable TTL cache.

### 2. Streaming

- Introduce a provider-neutral streaming event contract (B2).
- **Hybrid durability:** Ephemeral delivery to clients; **terminal** RunStep persistence with full usage even on client disconnect (default policy).
- Do not conflate container stdout streaming with LLM token streaming.

### 3. Batch inference

- **Three mechanisms:** (a) existing BullMQ Run execution for agents/eval, (b) **new** provider-native batch jobs with persisted `BatchInferenceJob` entity and reconciliation ticks, (c) bounded in-worker concurrency caps where appropriate.
- Provider batch states: `CREATED`, `SUBMITTED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED` (OSVA-owned, not provider SDK types in contracts).

### 4. Routing

- Add immutable **RoutingPolicyVersion** (workspace-scoped) selecting among **pre-authorized** `ModelProfileVersionId` values.
- Strategies: static (current), ordered fallback, cheapest eligible, lowest latency eligible, weighted cost/quality — all **deterministic under a frozen policy snapshot**.
- Evaluation A1–A5 outputs may inform **recommendations** and human promotion workflows; **must not** automatically change production bindings.

### 5. External libraries

| Option | Decision |
| --- | --- |
| LiteLLM | **Optional OpenAI-compatible connection endpoint only** (existing pattern); not a required OSVA dependency; reference for operator self-hosting |
| Vercel AI SDK | **Rejected** as primary adapter stack for current scope |
| Valkey | **Reuse** existing infrastructure |
| BullMQ | **Reuse**; no competing queue |

## Alternatives considered

### A. LiteLLM as required central proxy

**Pros:** Unified routing, caching, and multi-provider support out of the box.

**Cons:** Duplicates ModelProfile, connection, and RunStep accounting; Python operational footprint; workspace isolation and billing reconciliation remain OSVA problems; hidden retries conflict with per-RunStep provider attempt semantics.

**Rejected** for required dependency; retained as optional operator gateway via OpenAI-compatible `baseURL`.

### B. Vercel AI SDK replaces custom adapters

**Pros:** Streaming and tool-call ergonomics.

**Cons:** No dependency today; large migration; error and usage normalization already invested in `@osva/adapters-model-*`; Provider SDK types must stay out of contracts regardless.

**Rejected** for replacement; optional utility reuse may be reconsidered during B2 spike.

### C. Semantic cache in Valkey (embeddings)

**Pros:** Higher hit rate for paraphrased prompts.

**Cons:** False matches on tool selection, security prompts, and JSON generation; evaluation and agent decisions require exact behavior.

**Deferred** with default off.

### D. BullMQ-only “batch” (no provider batch API)

**Pros:** Simpler operations.

**Cons:** Misses provider batch pricing and large async jobs; conflates agent execution with offline inference.

**Partially accepted** for Runs; **not sufficient** for B3 provider batch slice.

## Consequences

**Positive**

- Clear separation: prompt cache (provider) vs response cache (OSVA).
- Accounting invariants preserved.
- Incremental milestones B1→B4 with independent verification.

**Negative**

- B2 requires runtime protocol extensions for remote HTTP `generateCompletion` / streaming if parity needed.
- B3 adds schema and operational polling burden.
- B4 requires governance UX for policy publication.

## Compliance

- Workspace isolation enforced at cache, connection resolver, and batch persistence layers.
- Secrets remain references; not embedded in cache keys.
- Unknown usage/cost remains null, not zero.

## References

- `docs/architecture/AI_INFERENCE_OPTIMIZATION.md`
- `docs/implementation/B0_INFERENCE_OPTIMIZATION_AUDIT.md`
- `packages/model-gateway/src/model-gateway.ts`
- `packages/observability/src/run-step-recorder.ts`
- `adapters/model-provider-connectivity/src/model-provider-connection-resolver.ts`