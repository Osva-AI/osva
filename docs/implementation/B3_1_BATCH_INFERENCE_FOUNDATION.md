# B3.1 — Native batch inference foundation

**Status:** READY FOR REVIEW (contracts + design; no adapter/worker/API implementation).

**Branch context:** `feat/aio-inference-optimization` (B0–B4 consolidated PR).

B3.1 delivers portable contracts, state transition rules, result correlation helpers, provider capability documentation, and focused unit tests. It does **not** implement provider API calls, worker processing, database migrations, or public batch HTTP endpoints.

## 1. Architecture audit (reuse)

| Area | Finding | Reuse for B3 |
| --- | --- | --- |
| `packages/model-gateway` | Synchronous `generateCompletion` (+ B2 stream) only | Extend with batch **port** in B3.2; keep gateway mediation |
| `packages/contracts` | B1 cache + B2 stream patterns | **B3.1** `batch-inference` types/schemas/tests |
| `packages/domain` | Model cost + usage on RunStep | Batch line accounting in B3.4; no double-count |
| `packages/orchestration` | Evaluation/judge BullMQ coordinators | **Reuse** transport for poll/reconcile ticks (B3.3) — not a second workflow engine |
| `packages/db` | No batch tables yet | Proposed entities below; migrations in B3.3/B3.4 |
| `apps/worker` | RunAttempt execution + recovery | Separate batch job worker concern; no RunAttempt heartbeat for provider poll |
| Provider adapters | OpenAI `7.15.0`, Anthropic `0.74.0`, Gemini fetch adapter | No batch SDK usage today |
| Valkey / BullMQ | Run queue + rate limits | Scheduled reconciliation jobs |
| Artifacts | Workspace-scoped artifact storage | JSONL input/output artifact refs for large batches (B3.2+) |
| Evaluation | Child Runs via suite orchestration | **Parallel Run execution (E)** — distinct from provider batch **(D)** |

**Invariant:** OSVA already has durable execution (PostgreSQL lifecycle + BullMQ transport). Provider-native batch is an **explicit, opt-in execution mode** for non-interactive workloads. Agent tool loops, approval waits, and interactive paths must not silently become provider batches.

### Execution boundaries

| Label | Mechanism | B3.1 |
| --- | --- | --- |
| A | Ordinary synchronous inference | Unchanged |
| B | Streaming inference (B2) | Unchanged |
| C | OSVA exact-response cache (B1) | **Does not apply** to batch items by default |
| **D** | **Provider-native async batch** | **B3 scope** |
| E | Parallel ordinary Runs (e.g. evaluation) | Unchanged |

## 2. Build vs reuse

| Option | Decision |
| --- | --- |
| OSVA BullMQ | **Reuse** for reconciliation scheduling only |
| PostgreSQL | **Reuse** as lifecycle authority for `BatchInferenceJob` |
| OpenAI / Anthropic / Gemini SDKs | **Extend in place** in B3.2 (no new gateway product) |
| LiteLLM | **No new dependency**; existing optional OpenAI-compatible base URL unchanged |
| Second generic workflow engine | **Rejected** |

## 3. Provider capability matrix

Capabilities are **documented** in `BATCH_INFERENCE_PROVIDER_CAPABILITIES` (`packages/contracts/src/batch-inference.ts`) from official provider docs and pinned SDK versions. Unsupported features are listed per provider in `unsupportedCapabilities`.

| Capability | OpenAI | Anthropic | Google Gemini |
| --- | --- | --- | --- |
| Native batch API | Yes | Message Batches | Yes (inline + JSONL) |
| Input JSONL upload | Yes | Inline requests (API) | Yes |
| Inline batch | No | Yes | Yes |
| List / retrieve batch | Yes | Yes | Yes |
| Cancel | Yes | Yes | Yes |
| Output / error file download | Yes | Stream / download results | Output retrieval |
| `custom_id` correlation | Yes | Yes | Provider-defined keys |
| Arbitrary idempotency key | **No** (not assumed) | **No** | **No** |
| Per-item usage | Yes | Yes | Limited / model-dependent |
| Batch-level usage | Yes | Partial | Yes |
| Cached input accounting | Yes (batch tier) | Not same as OpenAI | Model-dependent |
| Universal 50% discount | **No assumption** | Model-specific batch pricing | Model-specific |

## 4. Portable contracts (format version `1`)

Implemented under `packages/contracts/src/`:

- `batch-inference.ts` — job/item types, eligibility (default **off**), capability matrix, accounting shapes
- `batch-inference-transitions.ts` — legal OSVA job status transitions; terminal states cannot regress
- `batch-inference-correlation.ts` — duplicate/missing/unexpected item detection
- `schemas/batch-inference.ts` — Zod validation (item count, payload bytes, duplicate ids, workspace binding)

### OSVA job lifecycle (local authority)

States: `CREATED`, `SUBMITTING`, `SUBMITTED`, `PROCESSING`, `FINALIZING`, `COMPLETED`, `PARTIALLY_COMPLETED`, `FAILED`, `CANCELLING`, `CANCELLED`, `EXPIRED`.

Terminal: `COMPLETED`, `PARTIALLY_COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED`.

**Note:** `PARTIALLY_COMPLETED` is a first-class OSVA outcome when the provider batch completes but items failed, were cancelled, or are missing from reconciliation. Provider `COMPLETED` ≠ all items succeeded.

### Provider batch lifecycle (normalized mirror)

`BATCH_INFERENCE_PROVIDER_JOB_STATUSES`: `UNKNOWN`, `VALIDATING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELLING`, `CANCELLED`, `EXPIRED`.

Mapped in adapters (B3.2); never conflated with OSVA job status in persistence.

### Item lifecycle

`PENDING` → `SUBMITTED` → `PROCESSING` → `SUCCEEDED` | `FAILED` | `CANCELLED` | `EXPIRED` | `UNKNOWN`.

## 5. Correlation and idempotency

- Every item has immutable `BatchInferenceItemId` (OSVA) and `providerCorrelationId` (provider-facing; unique per job).
- Results may arrive out of order; `reconcileBatchInferenceItemOutcomes` detects missing, duplicate, and unexpected items.
- `submissionFingerprint` on create request: durable logical submit identity for B3.4 (worker restart dedup). **Do not** assume provider-side idempotency keys unless documented.
- **Ambiguous submit:** If provider accepts batch but local ACK fails, B3.4 must record `providerBatchId` before marking `SUBMITTED` and reconcile on recovery using list/get APIs — never blindly resubmit the same paid payload.
- **Double-submit protection:** Unique constraint on `(workspace_id, submission_fingerprint)` + transition guard `SUBMITTING` → `SUBMITTED` only after provider id persisted.

## 6. Security and authorization

- Workspace-scoped job identity on all contracts; cross-workspace provider batch ids are not exposed.
- `BatchInferenceEligibilityPolicy.batchInferenceEnabled` defaults to **false** via `createDefaultBatchInferenceEligibilityPolicy()`.
- Immutable `modelProfileVersionId` + `providerConnectionVersionId` on job snapshot.
- No credentials in serialized batch requests (connection resolution at execution time only).
- Sensitive workload denial flag on policy (`denySensitiveWorkloads` default true).
- Inputs/outputs may reside on provider infrastructure — document retention per provider matrix.
- Cancellation permission modeled in B3.3 API; cancel is async and may not prevent all item execution.
- Workspace deletion: B3.4 should cancel or orphan-policy provider jobs per workspace lifecycle hooks (implementation deferred).
- No logging of raw prompts or completions in batch reconciliation paths (operational constraint for B3.2+).

## 7. Usage and accounting

- Reuse `ModelUsage` and existing pricing snapshots on RunStep patterns.
- `BatchInferenceUsageAccountingSnapshot`: per-item lines only when provider reported usage; batch-level rollup when provided.
- No fabricated token counts; omit usage/cost when unknown (`usageIncomplete` pattern from sync path).
- No estimated charges for items never processed.
- Separate **actual provider charges** from **estimated savings** (no hardcoded universal discount).
- B1 exact-response cache does not apply to batch submission path.
- B2 streaming does not apply to async result file retrieval.

## 8. Durable execution design (B3.3 / B3.4 — not implemented in B3.1)

### Proposed PostgreSQL entities

**`batch_inference_jobs`**

| Column | Purpose |
| --- | --- |
| `id` | `BatchInferenceJobId` |
| `workspace_id` | Isolation |
| `status` | OSVA lifecycle |
| `provider` | Resolved provider |
| `provider_batch_id` | After submit |
| `provider_status` | Normalized mirror |
| `model_profile_version_id` | Immutable binding |
| `provider_connection_version_id` | Immutable binding |
| `submission_fingerprint` | Unique per workspace |
| `progress_*` | Denormalized counts |
| `input_artifact_id` | JSONL snapshot ref |
| `output_artifact_id` | Optional |
| `pricing_snapshot_id` | Immutable pricing |
| `expires_at` | Provider TTL |
| `created_at`, `updated_at` | Audit |

Indexes: `(workspace_id, status)`, unique `(workspace_id, submission_fingerprint)`, `(provider, provider_batch_id)`.

**`batch_inference_items`**

| Column | Purpose |
| --- | --- |
| `id` | `BatchInferenceItemId` |
| `job_id` | FK |
| `provider_correlation_id` | Unique per job |
| `status` | Item lifecycle |
| `usage_json` | Nullable |
| `result_artifact_id` | Optional |
| `error_json` | Optional |

Indexes: unique `(job_id, provider_correlation_id)`, `(job_id, status)`.

### BullMQ / worker

- Queue: `batch-inference-reconcile` (name TBD) with job id = `BatchInferenceJobId`.
- Tick actions: poll provider → transition OSVA state → fetch results → reconcile → finalize accounting.
- Leases/fencing: reuse worker lease patterns; poll interval separate from RunAttempt heartbeat.
- Retry: exponential backoff on transient provider errors; terminal provider failure → `FAILED` with item-level partials.

## 9. Implementation plan

### B3.2 — OpenAI vertical slice (in progress; not full B3.2)

**Verified in repo (Completion A):**

- Authenticated REST on web: `POST/GET /v1/batch-inference-jobs`, `GET …/:id`, `GET …/:id/items`, `POST …/:id/cancel`.
- Workspace policy `workspace_batch_inference_policies` (disabled by default); operators enable via trusted repository upsert (integration tests seed with `PostgresWorkspaceBatchInferencePolicyRepository.upsertPolicy`).
- PostgreSQL job/items persistence (migration `0041` locked), idempotency on `(workspace_id, submission_fingerprint)` with client-supplied key (min 16 chars).
- Worker recovery tick runs `BatchInferenceRecoveryCoordinator` → `ProcessBatchInferenceJobs` (submit once, poll/reconcile, out-of-order `custom_id` correlation).
- Submission ambiguity: `reconciliationRequired` on `SUBMITTING` blocks automatic resubmit.
- Deterministic fake OpenAI Batch API (`adapters/model-openai/test/fake-openai-batch-server.ts`); real-stack integration: `apps/worker/test/integration/batch-inference-openai.integration.test.ts`.
- Cross-workspace job read returns `404` (`BatchInferenceJobNotFoundError`).

**Completion B (B3.2) — implemented on branch:**

- Native batch adapters: OpenAI, Anthropic Message Batches, Gemini inline batch (fake-stack E2E in `batch-inference-openai.integration.test.ts`).
- Migration `0042_batch_inference_completion_b`: `request_material_hash`, `pricing_snapshot_json` (immutable pricing at create).
- Client idempotency: `submissionFingerprint` + material hash conflict → HTTP `409`.
- Worker reconciliation: per-item cost estimates, `usageFinalizedAt` guard, partial/cancel terminal states.
- Integration coverage (9 scenarios): lifecycle, policy off, idempotency, ambiguous submit, double reconcile, cancel, Anthropic, Gemini, policy repo.

**B3.3 production hardening (this branch):**

- Provider correlation validation (`partitionBatchInferenceProviderCorrelations`), quarantine via `reconciliationRequired`.
- Fenced `markSubmitted` (no duplicate `provider_batch_id`).
- OpenTelemetry batch counters via `createOtelBatchInferenceMetrics`.
- Integration: mixed fail, poll recovery, worker restart, dual-worker race, correlation ghost id ([`B3_BATCH_INFERENCE_OPERATIONAL_ACCEPTANCE.md`](../operations/B3_BATCH_INFERENCE_OPERATIONAL_ACCEPTANCE.md)).

**Remaining:**

- Provider-side idempotency lookup for ambiguous submit (operator-recorded recovery only).
- Public policy-enable HTTP (intentionally not exposed).
- Large result artifact offload beyond inline JSON.

### B3.2 — Provider adapters

- `BatchInferenceProviderAdapter` in model adapters: create, poll, cancel, download results (per provider).

### B3.3 — Orchestration + persistence

- Migrations for entities above.
- Worker reconcile coordinator; status transitions enforced via `assertBatchInferenceJobStatusTransition`.
- Internal admin/API surface (not public SDK) optional in same slice.

### B3.4 — Accounting + dedup hardening

- Persist provider ids before `SUBMITTED`.
- Reconcile usage into workspace billing aggregates without double count.
- Artifact retention alignment with workspace policy.

## 10. Tests (B3.1)

`packages/contracts/test/batch-inference.test.ts` covers:

- Valid/invalid create requests, duplicate item/correlation ids
- Result ordering independence, missing/duplicate/unexpected items
- Status transitions, terminal regression, cancellation/expiry paths
- Default eligibility off, capability matrix presence
- Bounds (item count schema), unknown format version, workspace requirements

No live provider calls.

## 11. Related documentation

- [AI Inference Optimization](../architecture/AI_INFERENCE_OPTIMIZATION.md)
- [B0 Inference Optimization Audit](./B0_INFERENCE_OPTIMIZATION_AUDIT.md)