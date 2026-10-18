# Human Identity and Workspace Access

M11 Slice 1 introduced OSVA-owned human identity, organization structure, workspace membership, and security audit persistence. Slices 2–3 added browser authentication, sessions, and Console integration on the same model ([`HUMAN_AUTHENTICATION.md`](HUMAN_AUTHENTICATION.md)).

See [ADR-008](../adr/ADR-008-human-identity-and-workspace-access.md) for decisions. Closeout: [`../operations/M11_CLOSEOUT_SUMMARY.md`](../operations/M11_CLOSEOUT_SUMMARY.md).

## Planes of authentication

```text
Machine callers (CLI / SDK / MCP / automation)
  → API key (unchanged)
  → RequestPrincipal (API_KEY)
  → Community Edition API-key RBAC

Human callers (browser / Console)
  → secure server-side session (Slice 2+)
  → UserId + workspace membership
  → HumanWorkspaceRole + HumanWorkspacePermission
  → mapping to AuthorizationAction for resource checks
```

API keys and human sessions remain separate. Machine `ADMIN` does not imply human `OWNER`.

## Domain concepts

| Concept | Purpose |
| --- | --- |
| `Organization` | Billing/administrative grouping of users (no automatic workspace resource access). |
| `User` | Human identity record (email, display name, status). |
| `OrganizationMembership` | User role within an organization (`OWNER`, `ADMIN`, `MEMBER`). |
| `WorkspaceMembership` | Explicit workspace access for a user with a fixed human role. |
| `SecurityAuditEvent` | Append-only security-relevant facts (membership changes, org creation). |

`Workspace.organizationId` is optional until an explicit identity-bootstrap operation links legacy workspaces to organizations.

## Workspace access resolution

```text
(UserId, WorkspaceId)
  → WorkspaceMembershipRepository.findActiveMembership
  → ResolvedWorkspaceAccess | no access
```

Organization membership alone does **not** satisfy workspace access. The resolver is implemented in `@osva/domain` as `resolveWorkspaceAccess`.

## Transactional invariants

Identity lifecycle operations run in PostgreSQL transactions with **`FOR UPDATE` locks** on the workspace (or organization) row and current `OWNER` membership rows:

- Multiple workspace `OWNER` memberships are allowed.
- Once any `OWNER` exists, the workspace must always retain **at least one** `OWNER`.
- Only a workspace `OWNER` may grant, revoke, promote, or demote another `OWNER` (enforced in `IdentityApplication`).
- Ownership transfer **promotes the target before demoting the source** in one transaction.
- Removal or demotion of an `OWNER` is rejected when it would leave zero owners (including under concurrent attempts).
- Organization `OWNER` memberships follow the same minimum-owner rule when organization role lifecycle is exercised.

## Security audit metadata

`SecurityAuditEvent.details` is bounded (`SECURITY_AUDIT_EVENT_DETAILS_MAX_BYTES`, 4 KiB serialized JSON). Details are **secret-free**: store stable ids and role enums only (for example `userId`, `membershipId`, `role`, `previousRole`). Do not store emails, passwords, session tokens, API keys, or credential digests in audit details.

## Persistence

Migration **`0024_identity_foundation_slice`** adds:

- `organizations`, `users`, `organization_memberships`, `workspace_memberships`, `security_audit_events`
- nullable `workspaces.organization_id`

Repository migration head after full M11: **`0026_better_auth_user_image`** (Slice 2 auth tables in **`0025_human_authentication_slice`**).

Existing tenant data and API keys are unchanged by migration alone; run **`pnpm identity:bootstrap`** to link legacy workspaces and provision the first human administrator.

## Slice 1 scope (historical)

Slice 1 delivered schema and domain only. Login, sessions, Better Auth, and Console UI shipped in M11 Slices 2–3 without renaming this foundation.
