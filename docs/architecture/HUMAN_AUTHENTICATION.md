# Human Authentication (M11)

M11 Slice 2 adds browser-oriented human authentication, server-side sessions, workspace-scoped human authorization, workspace membership administration, and security audit listing on top of the Slice 1 identity foundation. Slice 3 adds the Console human-session BFF and operator UI (login, workspace selection, membership administration). Closeout: [`../operations/M11_CLOSEOUT_SUMMARY.md`](../operations/M11_CLOSEOUT_SUMMARY.md).

See [ADR-008](../adr/ADR-008-human-identity-and-workspace-access.md) for identity and membership decisions.

## Authentication planes

```text
Machine / automation callers
  → Authorization: Bearer (API key)
  → ApiKeyRequestPrincipal
  → Community Edition RBAC on /v1/* (except human auth routes)

Human browser callers
  → osva.session_token HttpOnly cookie
  → HumanSessionRequestPrincipal
  → HumanWorkspaceRole + HumanWorkspacePermission
  → x-osva-workspace-id selects workspace context (must match path for workspace routes)
```

Bearer credentials are attempted **first** when present; invalid bearer does **not** fall back to a session cookie.

## Better Auth adapter ownership

**Better Auth 1.7.10** (MIT) is configured only in `@osva/adapters-auth` (`createOsvaBetterAuth`, `BetterAuthHumanAuthenticationService`, `BetterAuthOperatorPasswordTokenService`). `apps/web` invokes Better Auth through explicit `/v1/auth/*` handlers — never as a catch-all.

OSVA owns the canonical `users` table and `auth_*` session tables; Better Auth uses Drizzle against those tables.

### Session lifetime

Better Auth continues to issue and validate session tokens and to maintain a **12-hour sliding idle** expiry (`expiresIn` / `updateAge` in `createOsvaBetterAuth`).

OSVA enforces an additional **seven-day absolute** cap from `auth_sessions.created_at` (original sign-in time) in `BetterAuthHumanAuthenticationService`:

```text
idle deadline     = Better Auth sliding expires_at
absolute deadline = created_at + 7 days
effective deadline = earlier of idle and absolute
```

When the effective deadline has passed, OSVA treats the session as invalid (sign-out) even if idle expiry has not been reached. Cookie `Max-Age` and `/v1/auth/session` responses use the effective deadline.

## Persistence

Repository migration head: **`0026_better_auth_user_image`**.

| Migration | Purpose |
| --- | --- |
| **`0025_human_authentication_slice`** | Human session/account/verification tables; `users.status` adds `PENDING_SETUP` |
| **`0026_better_auth_user_image`** | Nullable `users.image` for Better Auth 1.7 user schema compatibility |

Existing rows are preserved; `image` defaults to SQL `NULL`.

## PENDING_SETUP → ACTIVE lifecycle

1. An operator with `MANAGE_MEMBERS` calls `POST /v1/auth/workspaces/:workspaceId/members/users`.
2. OSVA creates a `PENDING_SETUP` user and workspace membership.
3. The response includes a **one-time plaintext setup token** (never stored in audit logs).
4. Better Auth persists verification state in `auth_verifications` (`identifier = reset-password:<token>`, `value = userId`).
5. The user submits the token to `POST /v1/auth/setup/complete` with a new password.
6. Better Auth sets the credential, consumes the verification (single-use), and `@osva/adapters-auth` transitions the OSVA user to **`ACTIVE`**.
7. The user signs in with `POST /v1/auth/login` and receives a session scoped by workspace membership.

### Setup versus recovery versus disabled users

| Flow | Endpoint | Starting status | Outcome |
| --- | --- | --- | --- |
| **Initial setup** | `POST /v1/auth/setup/complete` | `PENDING_SETUP` | Password set; status → `ACTIVE` |
| **Recovery** | `POST /v1/auth/recovery/complete` | `ACTIVE` | Password reset; status stays `ACTIVE`; existing sessions revoked |
| **Disabled** | either endpoint | `DISABLED` | Rejected — no reactivation through password reset in Slice 2 |

Tokens expire per Better Auth `emailAndPassword.resetPasswordTokenExpiresIn`. Expired or reused tokens are rejected.

## Environment

| Variable | Purpose |
| --- | --- |
| `OSVA_AUTH_SECRET` | Better Auth secret (≥ 32 characters) |
| `OSVA_AUTH_BASE_URL` | Public base URL for auth callbacks |
| `OSVA_AUTH_TRUSTED_ORIGINS` | CSRF/trusted Origin allow list for mutating human routes |

Mutating `/v1/auth/*` routes (all non-`GET` methods) require a trusted `Origin`, or a trusted `Referer` origin when `Origin` is absent. An empty allowlist **denies** requests (fail-closed). Startup validates `OSVA_AUTH_BASE_URL` and trusted-origin entries (`http`/`https` only; no wildcards or credentials). When `OSVA_AUTH_TRUSTED_ORIGINS` is unset, the web process defaults to the origin of `OSVA_AUTH_BASE_URL`.

Human session traffic on `/v1/*` is rate-limited in Valkey under `osva:rl:human:v1:<userId>` (stable user id, not session token). API keys continue to use `osva:rl:key:v1:*`; unauthenticated callers remain on `osva:rl:unauth:v1:<source-ip>`.

See root `.env.example`.

## Bootstrap and recovery

| Command | Purpose |
| --- | --- |
| `pnpm identity:bootstrap` | First organization owner, link workspaces, print one-time setup token |
| `pnpm identity:recover` | Operator recovery; revokes all human sessions; prints recovery token |
| `pnpm db:identity-bootstrap` / `pnpm db:identity-recover` | Aliases of the above |

Setup and recovery complete through `POST /v1/auth/setup/complete` and `POST /v1/auth/recovery/complete`.

OCI: `OSVA_PROCESS=identity-bootstrap` or `identity-recover` via [`deploy/docker/entrypoint.sh`](../../deploy/docker/entrypoint.sh).

## Roles and permissions

Human workspace roles: `OWNER`, `ADMIN`, `DEVELOPER`, `OPERATOR`, `VIEWER`.

Permissions include `READ`, `EXECUTE`, `WRITE`, `ADMINISTER_WORKSPACE`, `MANAGE_MEMBERS`, and `TRANSFER_OWNERSHIP`. Machine API keys continue to use `AuthorizationAction` (`READ` / `EXECUTE` / `WRITE` / `ADMIN`).

### Permission inventory and default deny

Every `/v1` route appears in `V1_ROUTE_ACCESS_INVENTORY` (`apps/web/src/v1-route-human-access-inventory.ts`). Unlisted routes are denied. Control-plane routes require a mapped human permission derived from the route authorization action.

**Operational classification:** `POST /v1/knowledge/retrieve` is **`EXECUTE`** (not inferred from HTTP POST → `WRITE`). `OPERATOR` may call it.

Human identity workspace routes map through `HUMAN_ROUTE_PERMISSIONS` in `@osva-ai/contracts`.

## Membership API

All routes require an authenticated human session. Workspace-scoped routes require `x-osva-workspace-id` matching the path workspace id.

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/auth/workspaces/:workspaceId/memberships` | `MANAGE_MEMBERS` |
| `POST` | `/v1/auth/workspaces/:workspaceId/memberships` | `MANAGE_MEMBERS` — add existing user (non-owner role) |
| `POST` | `/v1/auth/workspaces/:workspaceId/members/users` | `MANAGE_MEMBERS` — provision `PENDING_SETUP` user |
| `PATCH` | `/v1/auth/workspaces/:workspaceId/memberships/:membershipId` | `MANAGE_MEMBERS` — change non-owner role |
| `DELETE` | `/v1/auth/workspaces/:workspaceId/memberships/:membershipId` | `MANAGE_MEMBERS` — remove non-owner membership |
| `POST` | `/v1/auth/workspaces/:workspaceId/memberships/:membershipId/grant-owner` | `TRANSFER_OWNERSHIP` |
| `POST` | `/v1/auth/workspaces/:workspaceId/ownership/transfer` | `TRANSFER_OWNERSHIP` |

Generic membership routes **reject `OWNER`** targets and assignments. Foreign-workspace membership ids return **403** without leaking existence.

### Provisioning and setup tokens

`POST .../members/users` creates a `PENDING_SETUP` user, workspace membership, and returns a **one-time plaintext setup token** in the response body only. Better Auth stores verification metadata in `auth_verifications` without retaining the plaintext token in OSVA audit payloads.

This is operator provisioning — **no email delivery** in Slice 2.

### Ownership semantics

- **Grant owner** (`.../grant-owner`): promotes an existing member to `OWNER` while retaining other owners (supports multiple owners).
- **Transfer** (`.../ownership/transfer`): promotes the target member to `OWNER` and demotes the initiating owner (default demotion `ADMIN`) in one transaction.

Database transactions lock workspace owner scope and enforce **at least one active `OWNER`** after every owner-touching mutation.

### Session revocation

Membership removal invalidates workspace access on the next request (membership lookup). Operator recovery (`pnpm identity:recover`) revokes **all** human sessions for the recovered user.

## Console BFF (M11 Slice 3)

The OSVA Console (`apps/console`) exposes same-origin `/api/v1/*` routes that forward the browser `osva.session_token` cookie to `apps/web`. The BFF strips upstream `Domain` from `Set-Cookie`, rejects browser `Authorization` headers, forwards `Origin` for CSRF-protected mutations, and applies `x-osva-workspace-id` from the browser on workspace-scoped routes. The browser stores the selected workspace id in `sessionStorage` only as a non-secret preference.

Deprecated opt-in API-key BFF mode: `OSVA_CONSOLE_LEGACY_API_KEY_MODE=true` plus `OSVA_CONSOLE_API_KEY`.

## Explicitly deferred (post-M11)

- Global `/v1/users/:userId/disable|enable` (organization-level authority required)
- **Community (future):** email invitations, OIDC, MFA
- **Teams / Enterprise:** SAML, SCIM, custom roles, enterprise policy

## Existing installations

Use `pnpm identity:bootstrap` to attach an organization owner to previously unlinked workspaces without disturbing API keys or product data.
