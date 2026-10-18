# Human Identity and Workspace Access

M11 Slice 1 introduces OSVA-owned human identity, organization structure, workspace membership, and security audit persistence. Browser authentication and Console login are **not** part of this slice.

See [ADR-008](../adr/ADR-008-human-identity-and-workspace-access.md) for decisions.

## Planes of authentication

```text
Machine callers (CLI / SDK / MCP / automation)
  → API key (unchanged)
  → RequestPrincipal (API_KEY)
  → existing Community Edition RBAC

Human callers (future browser sessions)
  → secure server-side session (Slice 2+)
  → UserId + workspace membership
  → HumanWorkspaceRole + HumanWorkspacePermission
  → optional mapping to AuthorizationAction for resource checks
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

Existing tenant data and API keys are unchanged by migration alone.

## Out of scope (Slice 1)

Login routes, sessions, passwords, OIDC, Console UI changes, Better Auth integration, identity-bootstrap HTTP, and exposing human identity on public `/v1` responses.
