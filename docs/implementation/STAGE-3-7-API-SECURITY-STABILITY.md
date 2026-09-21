# Stage 3.7 — API Security and Stability

Stage 3.7 delivers authenticated Community control-plane security, stable `/v1` semantics, client convergence, connector hardening, migration integrity tooling, structured security observability, and JSON body limits.

## Architecture (Passes 1–4)

```text
OSVA API key
→ authentication (Pass 1)
→ RequestPrincipal
→ ControlPlaneScope
→ principal-derived workspace
→ workspace-scoped lookup (Pass 2)
→ centralized authorization (Pass 2)
→ application
→ PostgreSQL
```

Public clients (Pass 3):

```text
TypeScript SDK / Python SDK / CLI / MCP
→ Authorization: Bearer <osva_ak_…>
→ same API-key authority as REST
```

Connector security (Pass 3):

```text
Public REST redacts SecretReference.key
Execution adapters resolve secrets at connection boundary
MCP HTTP uses pinned outbound fetch + redirect denial
STDIO disabled by default (ADMIN + operator flag)
```

Migration safety (Pass 4):

```text
drizzle/*.sql + journal
→ migration-history.manifest.json (SHA-256 locks)
→ db:migrations:verify (read-only)
→ db:migrations:status (repo vs database)
→ db:migrate under PostgreSQL advisory lock
```

## Pass 4 deliverables

| Area | Implementation |
| --- | --- |
| Migration manifest | `packages/db/migration-history.manifest.json` |
| Verify / lock / status | `pnpm db:migrations:verify`, `db:migrations:lock`, `db:migrations:status` |
| Advisory lock | `packages/db/src/migration-advisory-lock.ts` wraps `migrateDatabase` |
| Acceptance tests | `packages/db/test/integration/migration-acceptance.integration.test.ts` |
| REST baseline | `apps/web/src/v1-rest-compatibility-baseline.ts` |
| Stable errors | `REQUEST_TOO_LARGE`, v1 error envelope tests |
| Security events | `@osva/observability` `SECURITY_EVENT_NAMES` + web wiring |
| JSON limits | `OSVA_DEFAULT_JSON_BODY_MAX_BYTES` (1 MiB) with workflow-event override |
| Docs | `docs/contracts/REST_API_V1.md`, tracker/roadmap updates |

## Security observability

Structured events (logs/traces; not unbounded metric labels):

- `auth.authentication_failed` (bounded `reasonCode`, never bearer token)
- `auth.authorization_denied`
- `api_key.created` / `api_key.revoked`
- `connector.egress_denied` / `connector.stdio_denied` / `connector.secret_resolution_failed`

## Community 1.0 scope (included)

Authenticated REST, workspace API keys + revocation, fixed RBAC, workspace isolation, shared REST/MCP auth, stable `/v1`, SDK auth model, MCP SSRF protection, STDIO operator gate, SecretReference redaction, migration integrity tooling, structured security events, JSON body default limit.

## Deferred (Enterprise / Stage 3.8+)

OIDC/SAML/SCIM, human accounts, organizations, custom roles, ABAC, external policy engines, Vault/cloud secret managers, durable compliance ledger, per-workspace network policy, rate limits/quotas/billing, STDIO sandboxing, connector OAuth, mTLS, Helm/production release packaging, npm/PyPI 1.0 publication.

## Migrations

Historical migrations `0000`–`0022` are immutable. Pass 4 added **no** new schema migration.

## Verification

Targeted tests during Pass 4; final gate: `pnpm verify:ci:clean` (once).
