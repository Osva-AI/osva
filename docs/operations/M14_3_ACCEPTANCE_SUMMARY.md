# M14.3 Acceptance Summary — Runtime Capability Token & Network Exposure Hardening

## Threat model

| Actor | Goal | Relevant surface |
| --- | --- | --- |
| Network neighbor / compromised host process | Invoke model/tool/memory/knowledge without OSVA mediation | Worker capability HTTP listener |
| Stolen capability or bootstrap token | Replay gateway side effects outside the intended RunAttempt | HMAC tokens + execution eligibility |
| Malicious remote/container agent | Escalate beyond frozen bindings | Capability bridge authorization |
| Operator misconfiguration | Accidentally expose authenticated capability bridge on all interfaces | Listener bind + advertised URLs |

**Trust boundaries preserved:** PostgreSQL remains lifecycle authority; capability tokens are transport credentials, not lifecycle records. HMAC execution tokens remain reusable for the duration of an eligible RUNNING attempt (multi-step agents). Bootstrap payload retrieval stays single-use per registration.

## Confirmed gaps addressed in this slice

| Gap | Mitigation |
| --- | --- |
| Non-container workers could bind non-loopback interfaces (including `0.0.0.0`, LAN/public IPs) via `OSVA_RUNTIME_CAPABILITY_HOST` without opt-in | `classifyCapabilityBindHost` + `validateRuntimeCapabilityListenerConfig` require loopback or explicit `OSVA_RUNTIME_CAPABILITY_ALLOW_PUBLIC_BIND=true` (acknowledgement only; no TLS/isolation) |
| Execution-token `aud` test used an invalid HMAC after payload mutation | Test signs a valid HMAC over claims that include `aud`, proving rejection is claim policy not signature failure |
| Execution tokens could carry arbitrary `aud` claims while still verifying | `verifyCapabilityToken` rejects any payload containing `aud` |
| Listener bind logic was duplicated inline in worker process | `resolveRuntimeCapabilityListenHost` centralizes container vs non-container bind |

## Controls already present (verified, not reimplemented)

- HMAC-SHA256 signatures with timing-safe comparison (`capability-token.ts`).
- Bootstrap vs execution audience separation (`RUNTIME_BOOTSTRAP_TOKEN_AUD`).
- Bootstrap single-use consumption (`RuntimeExecutionBootstrapStore.consume`).
- Cross-execution, cross-workspace, and cross-run claim checks in `RuntimeCapabilityBridge.authorize`.
- Terminal and lease-ineligible attempts filtered by `findCapabilityEligibleRunAttemptById` / `selectCapabilityEligibleRunAttempt`.
- Tool binding enforcement and rejection of client-supplied `toolVersionId` (M14.1 intact).
- Container bootstrap cleanup on success/failure/timeout (`executionBootstrap.clear`).
- Container capability URL validation against loopback when containers are enabled.
- REMOTE_HTTP pinned outbound policy unchanged (`@osva/outbound-network`).
- Capability tokens absent from structured logs in bridge/bootstrap tests.

## Token lifecycle and replay limitations

- **Execution tokens:** Valid while HMAC verifies, `exp` has not passed, claims match the persisted Run/RunAttempt, and the attempt is RUNNING with an active or legacy-unleased lease. Repeated model/tool/memory calls during that window are expected and allowed.
- **Bootstrap tokens:** Short-lived, execution-scoped, redeemable only on the bootstrap GET route; paired with single-use store consumption. Retries after worker restart rely on queue redelivery re-registering bootstrap payloads (documented tradeoff in `execution-bootstrap-store.ts`).
- **Not claimed:** Full replay prevention for stolen tokens during an active execution (would require breaking multi-step agents or persistent revocation state).

## Listener exposure and deployment requirements

| Mode | Bind | Reachability |
| --- | --- | --- |
| Default (REMOTE_HTTP, no containers) | `127.0.0.1` (config default) | Loopback only (`127.0.0.0/8`, `::1`, or `localhost` without opt-in) |
| Container enabled | `0.0.0.0` (required for bridge containers) | Non-container bind gate skipped; advertise container-reachable URL (`OSVA_CONTAINER_CAPABILITY_BASE_URL` or suggested gateway URL) |
| Operator non-loopback bind (non-container) | Any non-loopback IP literal with `OSVA_RUNTIME_CAPABILITY_ALLOW_PUBLIC_BIND=true` | HMAC-authenticated bridge on chosen interface; not TLS, not a sandbox |
| Hostnames other than `localhost` | Rejected at config load | No DNS resolution during validation (Windows/macOS/Linux) |

Capability endpoints are **not** rate-limited separately from the worker HTTP server (human auth rate limits from M14.2 apply only to control-plane auth routes).

## Compatibility impact

- **Breaking for misconfigured deployments only:** Non-container workers binding any non-loopback IP (including `0.0.0.0`, private LAN, or public addresses) must set `OSVA_RUNTIME_CAPABILITY_ALLOW_PUBLIC_BIND=true` or revert to loopback.
- Protocol, error codes, and token formats unchanged.

## Test results (direct execution)

| Command | Exit | Notes |
| --- | ---: | --- |
| `pnpm --filter @osva/adapters-runtime-http exec vitest run test/capability-token.test.ts test/capability-listener-bind.test.ts` (final corrections) | 0 | 32 tests |
| `pnpm --filter @osva/adapters-runtime-http build` | 0 | Worker imports updated bind exports |
| `pnpm --filter @osva/worker exec vitest run test/worker.test.ts` | 0 | 11 tests (includes LAN bind rejection) |

Docker-backed container integration tests were **not** re-run in this session (environment not validated here). Existing coverage: `adapters/runtime-container/test/**`, `apps/worker/test/integration/container-artifact-runtime.integration.test.ts`.

## Remaining risks

- Residual TOCTOU when a lease expires between eligibility read and gateway invoke (documented in `capability-eligibility.ts`).
- A network-reachable, token-authenticated listener remains a high-value target; network isolation and secret rotation are operator responsibilities.
- Bootstrap tokens in container env vars are visible to infrastructure with Docker inspect/host access (accepted Stage 3.1 trust model).

## Files touched

- `adapters/runtime-http/src/capability-listener-bind.ts` (new)
- `adapters/runtime-http/src/capability-token.ts`
- `adapters/runtime-http/src/index.ts`
- `adapters/runtime-http/test/capability-listener-bind.test.ts` (new)
- `adapters/runtime-http/test/capability-token.test.ts`
- `adapters/runtime-http/test/capability-bridge.test.ts`
- `apps/worker/src/config.ts`
- `apps/worker/src/process.ts`
- `apps/worker/test/worker.test.ts`
- `.env.example`
- `docs/deployment/CONFIGURATION.md`
- `docs/platform/AGENT_RUNTIME.md`
