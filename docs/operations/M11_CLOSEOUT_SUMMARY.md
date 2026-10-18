# M11 closeout summary — human identity, authentication, and Console

M11 is **complete** in this repository (Slices 1–3). Evidence checklist: [`M11_ACCEPTANCE_SUMMARY.md`](M11_ACCEPTANCE_SUMMARY.md).

## Delivered capabilities

| Area | What shipped |
| --- | --- |
| **Identity (Slice 1)** | OSVA-owned `User`, `Organization`, organization/workspace memberships, security audit events, workspace access resolver |
| **Authentication (Slice 2)** | Better Auth local password, HttpOnly `osva.session_token`, `/v1/auth/*`, setup and operator recovery, CSRF/trusted origins |
| **Authorization** | Fixed human workspace roles (`OWNER` … `VIEWER`), permission inventory, membership administration API |
| **Sessions** | 12-hour sliding idle (Better Auth) plus 7-day absolute cap from sign-in time |
| **Console (Slice 3)** | Login, logout, setup, recovery, workspace select/switch, role-aware UI, workspace access admin, security activity, human-session BFF |
| **Compatibility** | Existing workspace API keys unchanged; optional deprecated Console API-key BFF |

## Architectural decisions

- **ADR-008** — separate **human authentication** (browser session) and **machine authentication** (Bearer API key); workspace **authorization** for humans is membership + fixed roles, not organization membership alone.
- **`apps/web`** is authoritative for human auth and authorization; **Console BFF** forwards cookies and never mints browser API keys.
- **Better Auth 1.7.10** lives only in `@osva/adapters-auth`; OSVA owns canonical `users` and `auth_*` tables.
- AI Office `roles` / `team_memberships` remain organizational metadata, not security RBAC.

See [`../architecture/HUMAN_IDENTITY_AND_WORKSPACE_ACCESS.md`](../architecture/HUMAN_IDENTITY_AND_WORKSPACE_ACCESS.md), [`../architecture/HUMAN_AUTHENTICATION.md`](../architecture/HUMAN_AUTHENTICATION.md), [`../adr/ADR-008-human-identity-and-workspace-access.md`](../adr/ADR-008-human-identity-and-workspace-access.md).

## Migration head

Repository and upgrade target: **`0026_better_auth_user_image`**.

| Migration | Purpose |
| --- | --- |
| `0024_identity_foundation_slice` | Organizations, users, memberships, audit |
| `0025_human_authentication_slice` | Session/account/verification tables; `PENDING_SETUP` |
| `0026_better_auth_user_image` | Nullable `users.image` (Better Auth compatibility) |

Verify: `pnpm db:migrations:verify`.

## Compatibility guarantees

- **Machine callers:** CLI, SDK, MCP, and automation continue to use workspace-scoped API keys and Community Edition API-key roles (`VIEWER` / `OPERATOR` / `EDITOR` / `ADMIN`). Existing keys remain valid after migrate.
- **Human callers:** Console and browser use server-side sessions only; session tokens are not returned in JSON.
- **Public `/v1` product resources:** No breaking change to API-key contract semantics; additive human auth routes under `/v1/auth/*`.
- **Legacy Console:** `OSVA_CONSOLE_LEGACY_API_KEY_MODE=true` plus `OSVA_CONSOLE_API_KEY` is deprecated opt-in only.

## Security invariants

- Invalid Bearer credentials do **not** fall back to a session cookie.
- Browser mutations require trusted `Origin` / CSRF policy on human auth routes.
- Workspace isolation: foreign workspace IDs → **404**; in-workspace RBAC failures → **403**.
- At least one workspace `OWNER` after every owner-touching mutation (transactional).
- Organization membership does **not** imply workspace resource access.
- Audit `details` are secret-free (ids and enums only).

## Automated acceptance evidence

Primary integration and BFF tests are listed in [`M11_ACCEPTANCE_SUMMARY.md`](M11_ACCEPTANCE_SUMMARY.md). Focused verification for this closeout:

```bash
pnpm db:migrations:verify
pnpm --filter @osva/console test
pnpm --filter @osva/console test:integration
```

## Upgrade and operator steps

1. **Backup** PostgreSQL (and artifacts per your DR plan).
2. **Migrate** forward through **`0026_better_auth_user_image`** (`pnpm db:migrate` or Compose/Helm migrate job). See [`UPGRADE.md`](UPGRADE.md).
3. **Configure web auth** (required for human login):
   - `OSVA_AUTH_SECRET` — at least 32 characters (production: cryptographically random).
   - `OSVA_AUTH_BASE_URL` — public URL of `apps/web` (for example `http://127.0.0.1:8080` in Compose).
   - `OSVA_AUTH_TRUSTED_ORIGINS` — comma-separated browser origins allowed for mutating auth routes; include the Console origin (for example `http://127.0.0.1:5173`, `http://127.0.0.1:4174`).
4. **Bootstrap first administrator:** `pnpm identity:bootstrap` (or `OSVA_PROCESS=identity-bootstrap` in OCI). Save the one-time setup token from stdout.
5. **Complete initial setup:** `POST /v1/auth/setup/complete` or Console `/setup` with the token and a new password.
6. **Start Console** without `OSVA_CONSOLE_API_KEY` (default human-session mode). Set `OSVA_BASE_URL` to the control plane; see [`../engineering/CONSOLE.md`](../engineering/CONSOLE.md).
7. **Optional legacy Console:** enable `OSVA_CONSOLE_LEGACY_API_KEY_MODE` only when migrating old automation; not recommended for operators.

Existing API keys created before M11 continue to work for machine access.

## Deferred — future Community scope

Not part of M11; track as later Community milestones:

- **OIDC** and other external identity providers (future Community work — **not** delivered in M11)
- MFA, email delivery, invitations
- Custom roles, ABAC, departments (product sense)

## Deferred — Teams / Enterprise scope

- SAML, SCIM
- Enterprise policy packs, billing identity, impersonation
- Advanced governance and compliance ledger

## Related documentation

- [`../engineering/LOCAL_DEVELOPMENT.md`](../engineering/LOCAL_DEVELOPMENT.md) — Compose and contributor Console journeys
- [`../deployment/CONFIGURATION.md`](../deployment/CONFIGURATION.md) — environment variables
- [`UPGRADE.md`](UPGRADE.md) — migration procedure
- [`../release/COMPATIBILITY.md`](../release/COMPATIBILITY.md) — release policy
