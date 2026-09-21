# REST API V1 (Stage 3.7 freeze)

`/v1` is the public major REST version for OSVA Community 1.0.

## Authentication

- All `/v1/*` routes require `Authorization: Bearer <osva_ak_…>`.
- Public probes: `GET /health`, `GET /ready` only.
- Workspace identity is derived from the authenticated `RequestPrincipal`.
- Client-supplied workspace IDs in bodies or query strings are not authoritative.

## Authorization and tenancy

| Condition | HTTP | Code |
| --- | --- | --- |
| Missing/invalid API key on `/v1` | 401 | `AUTHENTICATION_REQUIRED` |
| Missing resource or foreign workspace ID | 404 | `RESOURCE_NOT_FOUND` |
| Resource in workspace, role lacks action | 403 | `PERMISSION_DENIED` |
| JSON body above default limit | 413 | `REQUEST_TOO_LARGE` |

Foreign workspace access must not return `403` (existence leak).

## Error envelope

Stable security and tenancy errors use:

```json
{
  "status": "error",
  "code": "AUTHENTICATION_REQUIRED",
  "requestId": "…"
}
```

Clients must key on HTTP status and stable `code` values, not message text.

## Compatibility within `/v1`

Generally safe:

- new endpoint;
- new optional request field;
- new optional response metadata clients can ignore;
- additive enum values (still risky for exhaustive clients);
- internal implementation changes preserving semantics.

Breaking:

- removing or renaming fields/endpoints;
- changing field types or meaning;
- changing identity or workspace semantics;
- changing pagination ordering contracts;
- making optional request fields required;
- incompatible error-code changes.

Breaking `/v1` changes require `/v2` or a documented major transition.

## Machine-enforced baseline

Route existence: `apps/web/src/v1-route-inventory.ts` (+ HTTP probe parity test).

Security baseline: `apps/web/src/v1-rest-compatibility-baseline.ts` freezes method, path, authentication requirement, minimum authorization action, and resource family. CI fails if a stable route disappears or its security classification changes without updating the baseline.

## SDK expectations

- TypeScript: `new OsvaClient({ baseUrl, apiKey })`.
- Python: `OSVAClient(base_url=…, api_key=…)`.
- CLI: `OSVA_BASE_URL`, `OSVA_API_KEY` (no `OSVA_WORKSPACE_ID` security context).

## Versioning and deprecation

Follow `docs/architecture/COMPATIBILITY_AND_MIGRATION.md` for contract versioning and deprecation windows.
