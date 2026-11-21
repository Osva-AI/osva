# LiteLLM and OpenAI-Compatible Gateways (Operator Guide)

Status: **C2 canonical reference** — use this document for self-hosted LiteLLM (or any OpenAI-compatible proxy) with OSVA. OSVA does **not** ship or require LiteLLM as a dependency.

**Related decisions:** [ADR-012](../adr/ADR-012-inference-optimization-architecture.md) (optional OpenAI-compatible endpoint only), [B0 inference audit](../implementation/B0_INFERENCE_OPTIMIZATION_AUDIT.md) (§4.1), [M12.1 acceptance](./M12_1_ACCEPTANCE_SUMMARY.md), [M12.3 cross-capability acceptance](./M12_3_ACCEPTANCE_SUMMARY.md).

## When a proxy is useful

Use a self-hosted **OpenAI-compatible HTTP gateway** (LiteLLM, vLLM OpenAI server, Ollama with `/v1`, etc.) when operators want:

- A single internal URL and API key for many upstream models
- Private-network inference without exposing provider keys inside every worker
- Provider routing **outside** OSVA (while OSVA keeps workspace policy, Runs, and billing authority)

Do **not** adopt a proxy expecting it to replace OSVA **inference routing** (B4), **workspace budgets** (B5), **exact-response cache** (B1), or **RunStep** accounting. Those remain OSVA-owned.

## Minimal configuration

OSVA treats the proxy as a normal **OPENAI** `ModelProviderConnection` with a custom `baseUrl`. No LiteLLM-specific adapter or SDK.

| Layer | Operator choice |
| --- | --- |
| Connection `provider` | `OPENAI` |
| Connection version `endpoint.baseUrl` | LiteLLM base, e.g. `https://litellm.internal.example/v1` (must include `/v1` if the proxy serves OpenAI paths under that prefix) |
| `endpoint.allowPrivateNetworks` | `true` when the proxy is on RFC1918/loopback; required for Compose/k8s private URLs (`@osva/outbound-network`; see [external ecosystem compatibility](../architecture/EXTERNAL_ECOSYSTEM_COMPATIBILITY.md)) |
| Credential | `credentialRef` → workspace secret (env-backed in dev, operator secret store in prod). Use the **LiteLLM virtual key** (or master key per your threat model) as the OpenAI `apiKey` wire value |
| `ModelProfileVersion.provider` | `OPENAI` |
| `ModelProfileVersion.model` | **Exact model string LiteLLM expects** (e.g. `gpt-4o`, `anthropic/claude-3-5-sonnet`, or a LiteLLM model alias) |
| `ModelProfileVersion.modelProviderConnectionVersionId` | Bound connection version |
| Pricing on `ModelProfileVersion` | Operator-defined `pricing` for OSVA **estimates** and budget preflight; not sourced from LiteLLM invoices |

### API / Console flow

1. `POST /v1/model-provider-connections` (workspace, key, `provider: OPENAI`)
2. `POST /v1/model-provider-connections/{id}/versions` with `endpoint` + `credentialRef`
3. `POST …/test` with `model` matching a LiteLLM route (optional but recommended)
4. Create `ModelProfile` + append `ModelProfileVersion` with connection binding and model id
5. Bind agent / enable routing policy as usual

Console placeholder for base URL: `apps/console/src/client/routes/model-connection-detail-page.tsx` (`https://litellm.example.com/v1`).

### Compose / env note

Legacy env keys (`OPENAI_API_KEY`, etc.) apply only when **no** connection binding is used. Connection-bound profiles resolve secrets via `SecretReference` keys; see `deploy/compose/.env.example` (LiteLLM comment block).

## OSVA authority vs proxy behavior (Slice C)

When a profile uses a proxy endpoint, the worker stack is unchanged:

`RunStepRecorder → RoutingModelGateway → CachingModelGateway? → BudgetEnforcingModelGateway → ModelGateway → OpenAIProviderAdapter (custom baseURL)`.

| Concern | Authoritative owner | Notes |
| --- | --- | --- |
| Model / routing policy selection | **OSVA** (`InferenceRoutingPolicy`, immutable version, workspace activation) | Proxy does not choose `ModelProfileVersion` or routing candidates |
| Ordered fallback / circuit breaker | **OSVA** (B4 + C1 streaming pre-output rules) | Disable proxy-side fallbacks/retries or accept double attempts |
| Exact-response cache hit | **OSVA** Valkey (B1) | Proxy prompt/response cache is **not** `OSVA_RESPONSE_CACHE_HIT` |
| Workspace budget / reservations | **OSVA** (B5) | One reservation per `providerAttemptIndex`; proxy-hidden retries can inflate real HTTP without OSVA visibility |
| Provider attempt telemetry | **OSVA** RunSteps + `inference_routing_decisions` | Proxy logs are supplementary only |
| Credentials & workspace isolation | **OSVA** PostgreSQL + `SecretResolver` | Virtual keys are still secrets; never commit plaintext |
| Estimated cost on routing decisions | **OSVA** pricing on `ModelProfileVersion` | May differ from LiteLLM spend reports |
| Retry on connection-bound OpenAI adapter | **OpenAI SDK retries disabled** (`OPENAI_CONNECTION_RESOLVED_MAX_RETRIES = 0`) | One logical OSVA attempt → one SDK call unless the **proxy** retries internally |

**Slice C1 streaming:** Retryable pre-output failures (e.g. HTTP 429 before stream bytes) may trigger OSVA routing fallback to another authorized profile. Mid-stream failure after consumer-visible output does **not** switch models (R8). Proxy streams must speak the same OpenAI-compatible streaming wire OSVA already supports (Responses / Chat Completions via `OpenAIProviderAdapter`).

## Version-pinned acceptance deployment (deterministic)

OSVA ships an **optional** live-proxy profile (not default CI). It runs a real LiteLLM process against a **host fake OpenAI upstream**—no production DB in LiteLLM, no paid inference, loopback-only publish.

| Item | Value |
| --- | --- |
| Image | `docker.litellm.ai/berriai/litellm:main-v1.63.11-stable` |
| Digest | `sha256:27c487bc6b4e15f0c09016679c65cbe82d533e42c613c951de743d658f41485d` |
| Master key (acceptance only) | `sk-osva-litellm-acceptance` via `LITELLM_MASTER_KEY` |
| Upstream | `host.docker.internal` → in-process fake OpenAI (`fake-openai-server.ts`) |
| Proxy retries / fallbacks | `num_retries: 0`; no `router_settings.fallbacks` in acceptance config |
| Virtual key | Acceptance uses master key as OpenAI wire credential (document threat model for production) |

```bash
pnpm acceptance:litellm:preflight   # Docker + pinned image pull
pnpm acceptance:litellm             # L1–L10 live-proxy matrix
pnpm acceptance:litellm:test        # config/script unit checks
```

Config template: `scripts/acceptance/litellm/fixtures/litellm-acceptance-config.yaml`. Implementation: `scripts/acceptance/litellm/run.mjs`, `apps/worker/test/integration/litellm-live-proxy.integration.test.ts`.

**Minimum proxy version:** OSVA uses the OpenAI **Responses API** (`/v1/responses`). LiteLLM Proxy **v1.63.8+** (acceptance pins `main-v1.63.11-stable`) is required; older proxies return 404 on `/v1/responses`.

**Production** operators should pin their own image digest, use LiteLLM virtual keys, private networking, and mirror `ModelProfileVersion.pricing`—do not reuse the acceptance master key.

## Wire compatibility (what CI proves)

Default CI automated tests use a **deterministic fake OpenAI server**, not a running LiteLLM process. They establish:

- Custom `baseUrl` on connection versions
- Model string forwarded on the wire
- Credential resolution and workspace binding
- Normalized text completion and streaming through `ModelGateway`

They do **not** certify every LiteLLM version, router YAML, or multi-provider alias edge case.

**Evidence:**

| Test | Command | Contract |
| --- | --- | --- |
| LiteLLM-style E2E | `pnpm --filter @osva/worker run test:integration -- test/integration/model-gateway.integration.test.ts -t "LiteLLM-style"` | OPENAI connection + custom origin + model id |
| Full connection matrix | Same file, full run | Anthropic/Gemini custom URLs, timeout, missing creds, workspace isolation |
| M12.3 BFF | `pnpm acceptance:m12-3` | Console + connection lifecycle (fake provider) |

Implementation: `adapters/model-provider-connectivity/src/model-provider-connection-resolver.ts` (`baseURL`, `maxRetries: 0`, 120s timeout).

## Operator checklist: proxy settings

Configure LiteLLM (or equivalent) so it does not fight OSVA:

1. **Retries:** Prefer `num_retries: 0` (or equivalent) on routes used by OSVA, or accept that proxy retries may cause extra upstream spend without matching OSVA reservation semantics.
2. **Fallbacks:** Disable LiteLLM router fallbacks for OSVA-bound virtual keys when B4 `allowFallback` is enabled — OSVA already orders candidates.
3. **Caching:** Treat proxy cache as opaque; OSVA exact-response cache is separate and keyed by workspace policy. Do not configure proxy cache as source of truth for Run accounting.
4. **Streaming:** Enable OpenAI-compatible streaming on the route; OSVA consumes SSE/chunk streams via the OpenAI adapter.
5. **Usage:** OSVA records token usage from provider JSON when present; missing usage → budget reconciliation paths per B5. Do not assume LiteLLM admin usage totals match `RunStep` aggregates.

## Cost and budget limitations

- B5 reserves from **OSVA pricing snapshots** on the selected `ModelProfileVersion`, not LiteLLM cost fields.
- Routing decision `estimatedCost` is diagnostic preflight only ([B4](../implementation/B4_INTELLIGENT_MODEL_ROUTING.md)).
- Invoices from LiteLLM or upstream providers require operator reconciliation outside OSVA unless you mirror pricing into `ModelProfileVersion`.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `MODEL_PROVIDER_UNAVAILABLE` / connection test fails | `allowPrivateNetworks`, DNS, TLS, or wrong `baseUrl` | Fix endpoint; test with `POST …/test` and explicit `model` |
| `MODEL_AUTHENTICATION_ERROR` | Virtual key not in secret store / wrong ref | Fix `credentialRef`; verify env or secret backend |
| `MODEL_ROUTING_NO_ELIGIBLE_CANDIDATE` | B4 policy, capabilities, or circuit breaker | Inspect routing policy; not a LiteLLM wire issue |
| Double provider charges | Proxy retries + OSVA fallback | Disable proxy retries or disable OSVA `allowFallback` for that workspace |
| Streaming works in curl but not OSVA | Wrong API surface (non-OpenAI path) | Point `baseUrl` at OpenAI-compatible `/v1` root LiteLLM documents |
| Budget `RECONCILIATION_REQUIRED` | Provider usage missing after stream | Upstream must return usage on completion when possible |

## Live-proxy scenario matrix (L1–L10)

Executed by `pnpm acceptance:litellm` when Docker is available:

| ID | Assertion |
| --- | --- |
| L0/L1 | Connection create/version/test + non-stream Run via proxy; upstream fake receives traffic |
| L2 | Full OSVA streaming path: SUCCEEDED Run, attempt output with streamed text, one upstream `stream: true` request, MODEL RunStep SUCCEEDED with usage metadata |
| L3 | Invalid proxy credential rejected; no secret in JSON |
| L4 | Unknown LiteLLM alias → classified HTTP failure |
| L5 | `inputTokens` / `estimatedCostUsdMicros` on RunStep |
| L6 | Immutable routing policy selects LiteLLM-backed `ModelProfileVersion` |
| L7 | Pre-output 429 fallback → two upstream models |
| L8 | Mid-stream failure → no fallback model calls |
| L9 | B5 enabled → ≥2 budget reservations with terminal states |
| L10 | `litellm-proxy-retry-risk` route (`num_retries: 12`) → logs upstream `gpt-routing-retry-429` call count, exactly 1 OSVA MODEL step; proxy-internal retries classified **NOT VERIFIED** unless multiple upstream calls are observed |

For protocol-only regression without Docker, use `model-gateway.integration.test.ts` (fake server only).

## C3 integration stance

**NO-GO** for embedding LiteLLM inside OSVA (required dependency, second routing plane, or duplicate gateway). **GO** for operator-hosted OpenAI-compatible `baseUrl` on existing connections — this guide.