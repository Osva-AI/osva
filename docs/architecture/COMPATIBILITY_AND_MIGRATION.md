# Compatibility and Migration

## Version public contracts

Explicitly version:

- Agent Manifest;
- Runtime Protocol;
- Workflow Definition;
- Event Envelope;
- Tool Contract;
- REST API;
- SDK;
- adapter interfaces.

## Adapter replacement

Replacing an implementation must preserve:

1. product semantics;
2. canonical OSVA IDs;
3. persisted historical state;
4. documented compatibility.

## Deprecation

```text
introduce new version
→ support old + new
→ migration
→ deprecation
→ removal at major boundary
```

## Database migration history (Stage 3.7 Pass 4)

Historical Drizzle SQL through the current repository head is locked in
`packages/db/migration-history.manifest.json` (ordered filename + SHA-256 digest).

```text
pnpm db:migrations:verify   # read-only integrity gate (CI harness)
pnpm db:migrations:lock     # append-only manifest update for new 0023+ migrations
pnpm db:migrations:status   # compare repository head vs applied database rows
pnpm db:migrate             # advisory-locked migrator (also used by db:bootstrap)
```

Rules:

- never edit locked SQL in place;
- append new migrations only after the current head;
- CI verification must not rewrite manifests silently.

## REST `/v1` compatibility (Stage 3.7 freeze)

See `docs/contracts/REST_API_V1.md` for the public contract.

`/v1` is the public major REST version.

Generally safe within `/v1`:

- new endpoint;
- new optional request capability;
- new optional response field clients can ignore;
- new internal implementation;
- new additive metadata.

Breaking within `/v1`:

- removing or renaming fields;
- changing field types or meaning;
- changing resource identity semantics;
- changing pagination ordering semantics;
- making optional request fields mandatory;
- removing endpoints;
- changing workspace ownership semantics;
- incompatible stable error-code changes.

Enum additions are not automatically safe for exhaustive clients.

### Authentication

Workspace identity is derived from the authenticated principal. Client-provided
workspace IDs in request bodies or query parameters are not authoritative in stable `/v1`.

### Errors

Clients must key on stable machine codes (for example `AUTHENTICATION_REQUIRED`,
`PERMISSION_DENIED`, `RESOURCE_NOT_FOUND`, `REQUEST_TOO_LARGE`), not human-readable messages.

Insufficient role within the authenticated workspace maps to `403 PERMISSION_DENIED`.
Missing resources and foreign-workspace IDs map to `404 RESOURCE_NOT_FOUND`.
Do not expose cross-workspace existence via `403`.

### MCP

MCP inbound authentication uses the same OSVA workspace API keys as REST
(`Authorization: Bearer` + `GET /v1/auth/context`). Legacy environment bearer
mappings are superseded (see Stage 3.7 implementation docs).

### Machine baseline

`apps/web/src/v1-rest-compatibility-baseline.ts` enforces stable route security
metadata alongside `apps/web/src/v1-route-inventory.ts`.
