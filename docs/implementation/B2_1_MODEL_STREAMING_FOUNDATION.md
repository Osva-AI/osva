# B2.1 — Model streaming foundation

Contracts (B2.1), in-process provider streaming (B2.2), and trusted worker IPC streaming (B2.3). Public HTTP/SSE and Console live delivery remain B2.4+.

**Acceptance status:** See [`docs/operations/B2_ACCEPTANCE_SUMMARY.md`](../operations/B2_ACCEPTANCE_SUMMARY.md) (implementation **COMPLETE**; branch **LOCAL_PASS** **pending**).

## Build versus reuse

| Area | Decision |
| --- | --- |
| OpenAI / Anthropic SDK | Use native streaming APIs in **B2.2** (already vendored SDKs). |
| Gemini | Use existing adapter HTTP/SDK streaming surface in **B2.2**. |
| LiteLLM / Vercel AI SDK | **Rejected** — no evidence of need; would bypass existing adapters. |
| ModelGateway | `generateCompletionStream` delegates to provider adapters (B2.2). |
| RunStep / usage | Reuse terminal `GenerateCompletionResult` assembly; persist once at end. |

## Event model

- Format version: `MODEL_STREAM_EVENT_FORMAT_VERSION = "1"`.
- Identity: `streamId` per logical invocation; monotonic `sequence` from zero.
- Kinds: `TEXT_DELTA`, `TOOL_CALL_START`, `TOOL_CALL_ARGUMENTS_DELTA`, `TOOL_CALL_COMPLETE`, `USAGE_FINAL`, `COMPLETED`, `FAILED`, `CANCELLED`.
- Types live in `@osva-ai/contracts` (`model-streaming.ts`); validation in `schemas/model-streaming.ts`.
- Terminal assembly: `assembleModelStreamCompletion` in `model-streaming-assembler.ts`.

## Delivery surface (B2.2+)

| Boundary | Shape |
| --- | --- |
| In-process ModelGateway | `AsyncIterable<ModelStreamEvent>` + `AbortSignal` |
| Trusted runtime / worker IPC | Discrete framed JSON events (**not** serialized AsyncIterable) |
| Browser / API consumer | Ephemeral channel (SSE/WebSocket/poll buffer), out of scope for B2.1 |

Distinguish **model token streaming** from container log streaming (`RuntimeExecuteResponse`) and generic HTTP response streaming.

## Cancellation and backpressure

- `AbortSignal` propagates from execution lease cancel and optional consumer abort.
- Browser disconnect **detaches the viewer** by default; does not cancel the durable Run unless execution policy says otherwise.
- Bounded buffers: `MODEL_STREAM_MAX_TEXT_DELTA_BYTES`, `MODEL_STREAM_MAX_TOOL_ARGUMENT_BYTES`, `MODEL_STREAM_MAX_EVENT_COUNT`.
- Slow consumers: gateway/worker may drop delivery after bounded buffer unless policy requires backpressure (B2.3).

## Terminal accounting

- Streamed invocations must assemble to the same canonical `GenerateCompletionResult` as a non-streaming call.
- `USAGE_FINAL` is optional; never fabricate token counts.
- One terminal event per stream (`COMPLETED`, `FAILED`, or `CANCELLED`).
- RunStep persistence remains terminal-only (existing observability path in B2.2).

## B1 cache interaction

- Non-streaming B1 exact-response caching is unchanged.
- **Streaming bypasses** OSVA response cache until interoperability is designed (no partial writes, no synthetic provider events on cache hit).
- Provider prompt-cache hits remain real provider invocations; OSVA cache hits remain non-provider.

## B2.2 provider integration (done)

| Provider | API | Tool streaming | Notes |
| --- | --- | --- | --- |
| OpenAI | Responses stream (text) + Chat Completions stream (tools/json) | Chat + Responses function-call events | Same routing as sync (`requiresChatCompletions`). |
| Anthropic | Messages `stream()` | `tool_use` block deltas | Cache read/write in `USAGE_FINAL` via existing usage normalizer. |
| Gemini | `:streamGenerateContent?alt=sse` | Function-call parts (snapshot deltas) | Cumulative candidate text deduped before `TEXT_DELTA`. |

- `ModelProviderAdapter.generateCompletionStream?` implemented on all three adapters.
- `ModelGateway.generateCompletionStream` resolves `ModelProfileVersion` and wraps with `wrapModelCompletionStream` (abort + bounds).
- `CachingModelGateway` forwards streaming without exact-response cache read/write.
- Errors before first event: throw `ModelGatewayError`. After partial output: terminal `FAILED`.

## B2.3 worker IPC (implemented)

Child → parent:

| `type` | Purpose |
| --- | --- |
| `model.generate.stream.request` | Start one streaming call (`callId`, binding, `GenerateCompletionInput`) |
| `model.generate.stream.close` | Child stopped consuming; parent aborts provider |

Parent → child:

| `type` | Purpose |
| --- | --- |
| `model.generate.stream.event` | One validated `ModelStreamEvent` frame (`callId` correlation) |
| `model.generate.failed` | Pre-stream failure (unknown binding, unsupported provider, validation) |

Rules:

- `callId` correlates one logical invocation; `streamId` is carried inside each event.
- Sequences are validated monotonically on the child consumer.
- Frames are JSON values bounded by `MODEL_STREAM_IPC_MAX_FRAME_BYTES`; total events capped by `MODEL_STREAM_MAX_EVENT_COUNT`.
- Terminal events are exactly one of `COMPLETED`, `FAILED`, or `CANCELLED`; no events after terminal.
- Parent `send()` backpressure aborts the provider stream rather than unbounded buffering.
- `ObservabilityModelGateway.generateCompletionStream` records one MODEL RunStep at terminal assembly (same usage/provenance rules as sync); streaming does not pass B1 cache context.
- **Early child close** (`model.generate.stream.close`): parent aborts the provider; no synthetic `COMPLETED`. Observability finalizes the MODEL RunStep as `FAILED` without token usage when no terminal event arrived. The RunAttempt may still `SUCCEEDED` if the agent returns valid output after stopping consumption (distinct from provider `FAILED` mid-stream, scenario C).

Trusted child API: `context.models.generateCompletionStream(binding, input)` → `AsyncIterable<ModelStreamEvent>`.

## B2.4A — Valkey Pub/Sub and authenticated SSE (done)

Cross-process observer path (no Console UI in this slice):

```text
Trusted agent → ModelGateway → ObservabilityModelGateway → RunLiveStreamPublisher
  → Valkey Pub/Sub → Web GET /v1/runs/:runId/stream → authorized SSE client
```

| Topic | Behavior |
| --- | --- |
| Configuration | `OSVA_RUN_LIVE_STREAM_ENABLED` on web and worker; `OSVA_RUN_LIVE_STREAM_TEXT_VISIBLE` on worker only (trusted projection policy). |
| Pub/Sub | Channel `osva:run-live:v1:{workspaceId}:{runId}`; separate Valkey publisher (worker) and subscriber (web) connections; **no replay** — late subscribers see terminal/status only via HTTP run APIs. |
| Viewer projection | Fail-closed `projectModelStreamEventToViewer`; text deltas denied unless `textDeltasVisible`; tool arguments, usage, and provider internals never forwarded. |
| SSE auth | API key or human session with run **read** in the authorized workspace; cross-workspace `404`; subscribe only after auth; `event: ready` after Valkey `SUBSCRIBE` is active. |
| Disconnect | Client close drops SSE and Valkey subscription only; Run and provider execution continue. |
| Failures | Publisher errors are swallowed; Runs and MODEL RunStep finalization unchanged; bounded publish size and deduped `receiving` status hints. |

B2.4B (Console) should reuse the same SSE contract and readiness barrier (`ready` before starting observer UX).

## B2.4B — Console live viewer (implemented)

| Layer | Behavior |
| --- | --- |
| BFF | `GET /api/v1/runs/:runId/stream` — human session cookie forwarded; workspace via `x-osva-workspace-id`; upstream `GET /v1/runs/:runId/stream`; incremental SSE proxy (no full buffering); client disconnect aborts upstream; legacy API-key Console mode returns **503**. |
| Client | `useRunLiveStream` — fetch + SSE parse (not `EventSource`, so workspace header is preserved); phases `CONNECTING` / `LIVE` / `ENDED` / …; bounded partial text; sequence gap → “may be missing” banner; max **2** reconnects without replay. |
| UI | `RunLiveOutputPanel` on Run detail — status-only when deployment hides text; partial text in `<pre>` (escaped); persisted Run output via existing polling remains authoritative. |
| Security | Same viewer envelopes as B2.4A (`runLiveStreamViewerEnvelopeSchema`); no tool args / no HTML rendering of model text; `OSVA_RUN_LIVE_STREAM_TEXT_VISIBLE` remains a trusted deployment flag (status-only default). |

**No replay:** Console reconnection does not fabricate history; final state from `GET /api/v1/runs/...` and attempt output.

## B2.4B plan (Console)

1. Console live Run viewer wiring against `GET /v1/runs/:runId/stream`.
2. UX for no-replay and post-terminal state from persisted run APIs.
3. Attach/detach without cancelling durable Runs unless execution policy requires it.