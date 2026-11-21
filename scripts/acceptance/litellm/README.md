# LiteLLM live-proxy acceptance (optional)

Validates OSVA **OPENAI** `ModelProviderConnection` against a real LiteLLM Proxy container with a deterministic fake OpenAI upstream on the host. Not part of default CI.

## Quick start

```bash
pnpm acceptance:litellm:preflight   # Docker + image pull only
pnpm acceptance:litellm
```

## Architecture

| Component | Role |
| --- | --- |
| `docker.litellm.ai/berriai/litellm:main-v1.63.11-stable` | Pinned proxy (digest in `constants.mjs`) |
| `fixtures/litellm-acceptance-config.yaml` | `num_retries: 0`, no router fallbacks, `host.docker.internal` upstream |
| `adapters/model-openai/test/fake-openai-server.ts` | Deterministic upstream (no paid APIs) |
| `apps/worker/test/integration/litellm-live-proxy.integration.test.ts` | L1–L10 scenarios |

Loopback publish only (`127.0.0.1`). No Compose profile changes.

## Evidence

Scenario matrix and authority boundaries: [`docs/operations/LITELLM_OPENAI_COMPATIBLE_GATEWAY.md`](../../docs/operations/LITELLM_OPENAI_COMPATIBLE_GATEWAY.md).