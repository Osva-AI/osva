# REST API V1 (Stage 3.7 freeze)

`/v1` is the public major REST version for OSVA Community 1.0.

## Authentication

Two **Community Edition** planes (M11):

| Plane | Routes | Credential |
| --- | --- | --- |
| **Machine** | Product `/v1/*` (except human auth routes) | `Authorization: Bearer <osva_ak_…>` |
| **Human** | `/v1/auth/*` and human-authorized product routes | HttpOnly session cookie (`osva.session_token`); mutating auth routes require trusted browser `Origin` |

- Public probes: `GET /health`, `GET /ready` only.
- Machine workspace identity is derived from the API-key `RequestPrincipal`.
- Human workspace context uses membership plus `x-osva-workspace-id` where required (must match path workspace id).
- Client-supplied workspace IDs in bodies or query strings are not authoritative for either plane.
- Invalid Bearer credentials do **not** fall back to a session cookie.

## Authorization and tenancy

| Condition | HTTP | Code |
| --- | --- | --- |
| Missing/invalid API key on `/v1` | 401 | `AUTHENTICATION_REQUIRED` |
| Missing resource or foreign workspace ID | 404 | `RESOURCE_NOT_FOUND` |
| Resource in workspace, role lacks action | 403 | `PERMISSION_DENIED` |
| JSON body above default limit | 413 | `REQUEST_TOO_LARGE` |
| Abuse rate limit exceeded | 429 | `RATE_LIMITED` |
| Rate-limit store unavailable | 503 | `SERVICE_UNAVAILABLE` |

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

`429 RATE_LIMITED` includes `Retry-After` (seconds) and `x-osva-request-id`. It is abuse protection, not a billing quota. Official TypeScript/Python SDKs and the CLI (via the Node SDK) do not automatically retry `429`. `503 SERVICE_UNAVAILABLE` is used when the Valkey rate-limit store is down; it is not a throttle signal.

Machine callers remain the API-key `RequestPrincipal` (`subjectId`, `workspaceId`, `role`, `authenticationMethod: API_KEY`). Human sessions use separate principal types and fixed workspace roles; public product JSON does not expose organization billing or invitation fields.

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
