# Stage 3.7 — API Security and Stability

## Pass 1 foundation (complete)

Pass 1 established durable authentication, authorization, request context, bootstrap,
and public error primitives for `/v1`. Existing control-plane routes remain
unauthenticated until Pass 2 workspace hardening.

## Authentication

- REST and future inbound MCP convergence target: `Authorization: Bearer <OSVA API key>`.
- Token prefix (frozen): `osva_ak_`
- Token shape: `osva_ak_<apiKeyId>.<high-entropy-secret>`.
- Secrets are 32 cryptographically random bytes, encoded as base64url in the token.
- PostgreSQL stores a fixed 32-byte SHA-256 digest of the secret (`secret_digest` bytea).
- Plaintext secrets are shown once at creation/bootstrap and are never logged or returned by REST.
- Authentication failures are uniform and do not reveal whether an ID exists, was revoked, or had an incorrect secret.

## Principal model

`RequestPrincipal` (in `@osva/contracts`) is the long-term provider-neutral identity:

```text
subjectId
workspaceId
role
authenticationMethod   // API_KEY in Community Edition
```

Stage 3.6 MCP continues to use environment-configured bearer tokens mapped to
`McpPrincipal.workspaceId`. Pass 3 will converge MCP onto persisted API keys using
the same verification path without changing the general principal abstraction.

## Community RBAC

Fixed roles: `VIEWER`, `OPERATOR`, `EDITOR`, `ADMIN`.

Authorization entry point:

```text
authorize(subject, action, resource, context)
```

Actions: `READ`, `EXECUTE`, `WRITE`, `ADMIN`.

## API-key persistence semantics

Repository operations are explicit:

```text
create(record)   // insert-only; duplicate ID fails
findById(id)
revoke(id, revokedAt)
countAll()
```

Generic persistence must not rotate secret verification material, workspace ownership,
or credential identity.

## Bootstrap (operator CLI)

Operator-only CLI (not HTTP):

```text
pnpm db:bootstrap
```

`pnpm db:bootstrap` may compose **migration + bootstrap** for initial installation.
That is not application startup auto-migration.

### Database state behaviour

| Workspaces | API keys | Result |
|------------|----------|--------|
| 0 | 0 | Create workspace + initial `ADMIN` key; print plaintext once |
| ≥1 | 0 | Fail unless `--workspace-id <id>` targets an existing workspace |
| any | ≥1 | `BootstrapAlreadyCompletedError` (no changes) |

When multiple workspaces exist and no API keys exist, bootstrap never auto-selects a workspace.

## Request context

Every REST request receives a server-generated request ID (`x-osva-request-id`), included
in v1 authentication/authorization error envelopes. Client-supplied correlation headers are
not authoritative.

## Pass 1 REST surface

- `GET /v1/auth/context` — authenticated introspection of `{ workspaceId, role }`.
- Existing routes remain unauthenticated until Pass 2.

## Pass 2 REST invariants (frozen)

### Authentication cutover

There is **no legacy unauthenticated `/v1` compatibility window**. OSVA is pre-1.0.

At Pass 2 completion:

- `/health` and `/ready` remain public.
- All relevant `/v1/*` control-plane APIs require authenticated OSVA credentials.
- `GET /v1/auth/context` remains authenticated.

### Production web composition

`WebSecurityServices` may remain optional during Pass 1 tests. After Pass 2, the normal
OSVA web process must **fail closed** if required authentication services cannot be
constructed. Missing security services must not silently run REST unauthenticated.

### Workspace-scoped resource lookup

Authenticated workspace must participate in resource lookup:

```text
repository.findByWorkspaceAndId(principal.workspaceId, resourceId)
```

Public REST mapping:

```text
resource does not exist                     -> 404 NOT FOUND
resource exists in another workspace        -> 404 NOT FOUND
resource exists in principal workspace
  but role cannot perform action            -> 403 PERMISSION_DENIED
```

Use `classifyRestResourceAccess(...)` in `@osva/domain` as the Pass 2 helper for this
distinction. Do not map foreign-workspace ownership failures directly to public 403.

## Database migration behaviour

```text
application startup != migrate database automatically
```

Production web/worker/scheduler/MCP processes must not implicitly migrate schema.
Migration advisory locking and history verification remain Pass 4.

## Deferred (explicit)

- Pass 2: mandatory auth + workspace scoping across `/v1` routes and repository lookup conversion.
- Pass 3: SDK/CLI/MCP API-key convergence.
- Pass 4: migration history hash lock, advisory lock, upgrade acceptance tooling.
- Stage 3.8 deployment work.
