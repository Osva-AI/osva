# ADR-008: Human Identity and Workspace Access

**Status:** Accepted (M11 complete — identity, authentication, Console human sessions)

## Context

OSVA Community Edition authenticates control-plane callers with workspace-scoped API keys. Operators need a first-class human identity model, organization structure, and workspace membership without breaking existing API-key automation or `/v1` contracts.

## Decision

### Authentication planes

- Humans authenticate through **secure server-side browser sessions** (Better Auth; see `docs/architecture/HUMAN_AUTHENTICATION.md`).
- CLI, SDK, MCP, agents, and automation continue using **API keys**.
- Human authentication and machine authentication remain **distinct** product paths.
- `apps/web` will be authoritative for authentication, workspace resolution, and authorization for humans.
- The Console BFF must **never** convert every human into a permanent ADMIN API key.
- The browser must **never** receive an OSVA API key.

### Organizations and membership

- Organizations and memberships are **OSVA-owned domain concepts** persisted in PostgreSQL.
- Organization membership does **not** automatically grant workspace-resource access.
- Workspace access requires an **explicit current workspace membership**.
- Existing AI Office `roles` and `team_memberships` tables are organizational metadata only; they are **not** security RBAC and are not reused for human access.

### Roles and permissions (M11)

- M11 uses **fixed standard roles and permissions** (no custom roles, ABAC, or external policy engines in this stage).
- **Human workspace roles:** `OWNER`, `ADMIN`, `DEVELOPER`, `OPERATOR`, `VIEWER`.
- **Existing API-key roles** (`VIEWER`, `OPERATOR`, `EDITOR`, `ADMIN`) and **authorization actions** (`READ`, `EXECUTE`, `WRITE`, `ADMIN`) remain unchanged for machine principals.
- Machine `ADMIN` API keys do **not** automatically gain human-membership or workspace-ownership permissions.
- **Organization membership roles:** `OWNER`, `ADMIN`, `MEMBER` (organization administration only; no implicit workspace resource access).

### Human workspace role matrix

Permissions are expressed as `HumanWorkspacePermission` values. API-key `AuthorizationAction` mapping applies only where noted for future session integration.

| Human role | Access workspace | Read | Execute | Write | Administer workspace | Manage members | Transfer ownership |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VIEWER | yes | yes | | | | | |
| OPERATOR | yes | yes | yes | | | | |
| DEVELOPER | yes | yes | yes | yes | | | |
| ADMIN | yes | yes | yes | yes | yes | yes | |
| OWNER | yes | yes | yes | yes | yes | yes | yes |

Mapped API-key actions for resource checks (human sessions on `/v1`; API keys unchanged):

| Human role | READ | EXECUTE | WRITE | ADMIN |
| --- | --- | --- | --- | --- |
| VIEWER | yes | | | |
| OPERATOR | yes | yes | | |
| DEVELOPER | yes | yes | yes | |
| ADMIN | yes | yes | yes | yes |
| OWNER | yes | yes | yes | yes |

Ownership invariant: a workspace may have **multiple** `OWNER` memberships. Once human ownership exists, the workspace must **always retain at least one** active `OWNER`. Only an existing workspace `OWNER` may grant, revoke, promote, or demote another `OWNER`. Ownership transfer promotes the target to `OWNER` before demoting the source, inside one transaction with row-level locking on the workspace owner scope. The same minimum-owner rule applies to organization `OWNER` memberships when organization roles change.

### Authentication technology

- **Better Auth 1.7.10** is **approved** for browser sessions (see `docs/architecture/HUMAN_AUTHENTICATION.md`).
- Slice 1 introduced identity schema; Slices 2–3 wire Better Auth through `@osva/adapters-auth` and Console human-session BFF.

### Deferred (post-M11)

**Future Community:** OIDC and other external identity providers, MFA, email delivery, invitations, custom roles, ABAC, departments.

**Teams / Enterprise:** SAML, SCIM, billing roles, impersonation, enterprise policy packs.

### Migrations and existing installations

- Migrations remain **additive** and **backward-compatible**.
- Existing workspaces are linked to organizations through a later explicit **identity-bootstrap** operation, not automatically during migration.
- `workspaces.organization_id` remains **nullable** during M11 migration and rollback compatibility.
- Historical migrations `0000`–`0023` are immutable; M11 adds **`0024_identity_foundation_slice`**, **`0025_human_authentication_slice`**, and head **`0026_better_auth_user_image`**.

## Consequences

- M11 adds human identity persistence, session authentication, and Console operator login without breaking API-key automation.
- API-key `/v1` behavior and contracts for machine callers remain unchanged.
- Human sessions use the same membership and permission model as Slice 1 without renaming human roles.
