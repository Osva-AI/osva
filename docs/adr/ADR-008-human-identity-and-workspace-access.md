# ADR-008: Human Identity and Workspace Access

**Status:** Accepted (Slice 1 foundation; Slice 2 human authentication)

## Context

OSVA Community Edition authenticates control-plane callers with workspace-scoped API keys. Operators need a first-class human identity model, organization structure, and workspace membership without breaking existing API-key automation or `/v1` contracts.

## Decision

### Authentication planes

- Humans will authenticate through **secure server-side browser sessions** (implemented in a later slice).
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

Mapped API-key actions for resource checks (human session slice, not API keys today):

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
- Slice 1 introduced identity schema only; Slice 2 wires Better Auth through `@osva/adapters-auth`.

### Deferred

Custom roles, ABAC, departments, SAML, SCIM, MFA, billing roles, impersonation, enterprise policy, invitations, and Console login routes.

### Migrations and existing installations

- Migrations remain **additive** and **backward-compatible**.
- Existing workspaces are linked to organizations through a later explicit **identity-bootstrap** operation, not automatically during migration.
- `workspaces.organization_id` remains **nullable** during M11 migration and rollback compatibility.
- Historical migrations `0000`–`0023` are immutable; identity foundation adds **`0024_identity_foundation_slice`**.

## Consequences

- Slice 1 adds schema, domain types, repositories, and a membership-based workspace-access resolver with **no externally visible authentication behavior change**.
- API-key `/v1` behavior and contracts remain unchanged.
- Slice 2+ can attach session authentication to the same membership and permission model without renaming human roles.
