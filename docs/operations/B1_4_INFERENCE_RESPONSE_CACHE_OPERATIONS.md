# B1.4 — Exact-response cache operations

Optional OSVA exact-response caching remains **default off**. Enable only after encryption keys and per-workspace policy are in place.

## Worker enablement

Set on the worker process:

| Variable | Required when | Purpose |
| --- | --- | --- |
| `OSVA_EXACT_RESPONSE_CACHE_ENABLED` | Yes | `true` / `1` / `yes` to compose cache |
| `OSVA_INFERENCE_CACHE_ENCRYPTION_ACTIVE_KEY_ID` | When enabled | Active write key id (opaque string) |
| `OSVA_INFERENCE_CACHE_ENCRYPTION_ACTIVE_KEY_B64` | When enabled | 32-byte AES key, base64 |
| `OSVA_INFERENCE_CACHE_ENCRYPTION_READ_KEYS_JSON` | No | JSON map of `{ "keyId": "base64" }` for decryption during rotation |

When disabled, no new env vars are required.

## Workspace policy (PostgreSQL)

Table: `workspace_inference_cache_policies` (migration `0040`).

- Default: no row → policy resolves to `enabled: false`.
- Enable per workspace via audited upsert (`PostgresWorkspaceInferenceCachePolicyRepository.upsertWithAudit`) or trusted operator tooling.
- `revoked_at` or `enabled: false` stops subsequent cache reuse; existing Valkey entries expire by TTL.
- Requires `determinism: REQUIRED_DETERMINISTIC` for cache eligibility.
- Each upsert bumps `updated_at`, which flows to `cachePolicyRevisionId` and is bound into exact-cache identity. Re-enable after revoke does not reuse entries written under an older revision without a manual Valkey purge.
- Each upsert bumps `updated_at`, which flows to `cachePolicyRevisionId` and is bound into exact-cache identity. Re-enable after revoke does not reuse entries written under an older revision without a manual Valkey purge.

## Encryption and rotation

- Write path uses the active key id.
- Add retired keys to `OSVA_INFERENCE_CACHE_ENCRYPTION_READ_KEYS_JSON` before removing them from the write path.
- Removing a read key without purge invalidates entries encrypted under that key (they bypass as `ENCRYPTION_FAILURE` and re-invoke the provider).
- Rotate: introduce new active key → deploy read-keys including old id → purge or wait for TTL → remove old key from read-keys.

## Purge and rollback

1. Set workspace policy `enabled: false` or set `revoked_at`.
2. Delete Valkey keys matching `osva:erc:v1:<workspaceId>:*` during a maintenance window (no full-keyspace scan in request paths).
3. Disable worker: unset `OSVA_EXACT_RESPONSE_CACHE_ENABLED` and restart workers.

## Metrics and billing

- Counter: `osva.inference_response_cache.events` with labels `kind` (`lookup_attempt`, `hit`, `miss`, `bypass`, `put_attempt`, `put_created`) and optional `reason`.
- RunStep `modelInvocationSource`: `OSVA_RESPONSE_CACHE_HIT` means **no** provider call; provider cached input tokens are only on real provider invocations (`PROVIDER_PROMPT_CACHE_HIT` / `PROVIDER_INVOKED`).
- `estimatedAvoidedCostUsdMicros` is not verified financial savings.

## Security restrictions

Caching remains ineligible for judge/pairwise paths, tool loops, non-deterministic settings, legacy env-only provider connections, and any workspace without explicit policy enablement.