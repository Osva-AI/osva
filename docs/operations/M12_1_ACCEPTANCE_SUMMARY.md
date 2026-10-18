# M12.1 Acceptance Summary — Model Provider Connections

Status: **CONDITIONAL** (automated acceptance complete; full browser Compose journey waived — see below).

## Implementation acceptance

- Workspace-scoped `ModelProviderConnection` registry with immutable `ModelProviderConnectionVersion` records.
- Optional `modelProviderConnectionVersionId` on immutable `ModelProfileVersion` bindings.
- REST `/v1/model-provider-connections` family with credential redaction and connectivity test (`EXECUTE`, explicit `model` or `modelProfileVersionId`).
- Shared `@osva/adapters-model-provider-connectivity` resolver used by web and worker; runtime workspace + provider checks on connection-bound execution.
- OpenAI-compatible custom `baseUrl` on connection versions (LiteLLM/Ollama/vLLM via OpenAI adapter); Anthropic/Gemini custom endpoints for integration/testing.
- Console Models navigation, connection management, model-specific connectivity test UI, AgentVersion model selector.
- Migration `0027_model_provider_connections` locked in `migration-history.manifest.json`.

## PostgreSQL evidence

- `pnpm db:migrations:verify` — PASS (`0027_model_provider_connections`).
- Direct integration: `pnpm --filter @osva/db exec vitest run --config vitest.integration.config.ts test/integration/model-provider-connection-repositories.integration.test.ts` — **7/7 PASS** (persist, duplicate keys, immutable versions, concurrent append, workspace isolation, MPV binding, FK enforcement).

## Worker execution evidence

- Direct integration: `pnpm --filter @osva/worker exec vitest run --config vitest.integration.config.ts test/integration/model-gateway.integration.test.ts` — **12/12 PASS** including legacy OpenAI, connection-bound OpenAI/Anthropic/Gemini, LiteLLM-style OpenAI-compatible fake, missing credentials, foreign-workspace binding rejection, connection-bound hang/timeout (cancelled model step, single provider request, no credential leakage).

LiteLLM acceptance is **protocol compatibility** via fake OpenAI server, not a deployed LiteLLM process.

## Security evidence

- REST: `apps/web/test/model-provider-connections-http.test.ts` — redacted versions, test requires model, no secrets in JSON.
- Console BFF: `apps/console/test/server.test.ts` — model connection version list redaction; connectivity test body forwarded without echoing API key or secret names.
- Workspace switching: React Query keys include `workspaceId` (`use-models.ts`); `resolve-console-client-workspace.test.ts` — distinct human-session clients per workspace header (no stale client reuse).
- Connection-bound timeout: worker integration hang test — failed run, no credential leakage, fake provider request aborted.

## Console acceptance evidence

- Unit: `@osva/console` typecheck PASS; `workflows-page.test.tsx` 3/3; `server.test.ts` model-provider BFF cases PASS.
- Integration: `apps/console/test/integration/console-human-session.integration.test.ts` (existing harness) — human login, workspace isolation, session/membership behavior with real Postgres/Valkey/web/console (not re-run in this closeout slice; prior green in focused verification).

### Waived: full M12.1 browser journey on Compose

There is **no** dedicated M12.1 acceptance runner. `deploy/compose` does **not** include Console; `pnpm acceptance:m9-7b` covers agent-run health, not model connections.

**Operator path** (deterministic local providers, no paid APIs):

1. Contributor stack: Postgres + Valkey per `docs/engineering/LOCAL_DEVELOPMENT.md`.
2. `pnpm db:migrations:verify` (applies through 0027).
3. Start web, worker, console with `OPENAI_API_KEY` (or test secret ref) pointing at a local fake OpenAI server (`adapters/model-openai/test/fake-openai-server.ts` pattern).
4. Human bootstrap via compose identity-bootstrap or web auth setup; sign in to Console.
5. Models → create connection → append version (`allowPrivateNetworks: true` for loopback fake) → test with explicit model id → create ModelProfileVersion → AgentVersion → Run → inspect steps/usage.
6. Switch workspace in UI; confirm connection list/query scope changes (API enforces workspace on mutations).

Waived until an operator runs the above or a future M12.1 scenario is added to an acceptance harness.

## Deployment compatibility

- **Compose** (`deploy/compose/.env.example`): optional legacy provider keys documented; connection-bound secrets via env-backed `SecretReference`; private network egress opt-in per connection version.
- **Helm** (`deploy/helm/osva/values.yaml`): no new required model-provider env vars; existing installs keep deterministic knowledge embeddings defaults. Connection-bound execution uses optional env keys already supported by worker/web wiring.

## Knowledge-worker `verify:changed` note

Failure `@osva/knowledge-worker#test: ECONNREFUSED 127.0.0.1:1` is **intentional** in `test/process.test.ts` (`BASE_ENV` uses invalid Postgres/Valkey ports). Under parallel Turbo `test`, vitest teardown could race (`EnvironmentTeardownError`, unhandled ioredis `ECONNREFUSED`). **Fix:** always `worker.stop()` after rejected `start()` in the first test (harness cleanup). Direct run: `pnpm --filter @osva/knowledge-worker exec vitest run test/process.test.ts` — PASS. Not an M12.1 regression.

## Verification commands (closeout)

| Check | Command | Result |
|-------|---------|--------|
| Knowledge-worker | `pnpm --filter @osva/knowledge-worker exec vitest run test/process.test.ts` | PASS |
| Console BFF | `pnpm --filter @osva/console run test -- server.test.ts resolve-console-client-workspace.test.ts` | PASS (38 tests) |
| Worker hang | `pnpm --filter @osva/worker exec vitest run --config vitest.integration.config.ts test/integration/model-gateway.integration.test.ts -t "times out connection-bound"` | PASS |
| Route inventory | `pnpm --filter @osva/web exec vitest run test/v1-route-inventory.test.ts -t "matches implemented"` | PASS (after `model-provider-connections` probe segments) |
| Migrations | `pnpm db:migrations:verify` | PASS |
| Changed gate | `pnpm verify:changed` | **PASS** (2026-10-18 closeout) |

## Deferred (M12.2 / M12.3)

- Tool/connector MCP import UI, agent capability matrix, cross-capability hardening acceptance.
- Dedicated M12.1 scenario in `scripts/acceptance/*` and Compose+Console end-to-end automation.

## Rollback

1. Stop web/worker processes.
2. Deploy previous binary.
3. Revert migration `0027` only when no connection-bound model profiles exist (additive schema).
