# Security Policy

## Status

OSVA **Community Edition** (`1.1.0-rc.2` release candidate prepared in-tree) is intended for production-style self-hosting when operators follow deployment hardening guidance. It builds on OSS **1.0.0** with additional hardening; it is still **not an arbitrary-code sandbox**: trusted and container runtimes require explicit operator configuration and isolation choices.

Release candidate builds are verified in CI but **not** publicly tagged or published to registries until RC.3 verification and maintainer approval.

## Reporting vulnerabilities

Do not disclose vulnerabilities through public issues or discussions.

Use GitHub Private Vulnerability Reporting when enabled:

https://github.com/Osva-AI/osva/security/advisories/new

## Include in reports

- affected component and commit/version;
- reproduction steps;
- potential impact;
- suggested mitigation if known;
- whether exploitation appears active.

## Security assumptions

OSVA treats as untrusted:

- API/browser input;
- model output;
- Tool output;
- webhook payloads;
- external files and retrieved knowledge chunks.

Secrets must be supplied via environment/secret stores (`OSVA_DATABASE_URL`, provider keys, S3 credentials). Represent product secrets through OSVA SecretReference contracts where applicable—not in manifests or prompts.

## Deployment hardening

- Protect `/v1` with API keys; complete bootstrap before exposing the web port.
- Configure `OSVA_MCP_ALLOWED_HOSTS` for MCP HTTP deployments.
- Keep `OSVA_MCP_STDIO_CONNECTORS_ENABLED=false` unless STDIO connectors are required.
- Keep `OSVA_CONTAINER_ENABLED=false` unless Docker Engine container execution is deliberately enabled.
- Terminate TLS at ingress/reverse proxy; do not expose database or Valkey ports publicly.
- Restrict outbound network access per your threat model (`OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS`, MCP private network flags default to off).
- Bind Community Console to loopback. Remote Console access requires a secure tunnel or an authenticating reverse proxy to that loopback listener. `OSVA_CONSOLE_ALLOW_PUBLIC_BIND` is deprecated and is not access control.
- Do not trust arbitrary `X-Forwarded-For` / `Forwarded` on `/v1` unless `OSVA_TRUSTED_PROXIES` lists the connecting proxy CIDRs.

## Community identity

Community Edition identity is the API-key `RequestPrincipal`: `subjectId`, `workspaceId`, `role` (`VIEWER` / `OPERATOR` / `EDITOR` / `ADMIN`), and `authenticationMethod: API_KEY`. There are no native member accounts, login sessions, invitations, SSO, SCIM, custom RBAC, billing, or license enforcement.

Future Team or Enterprise management can map an individual identity onto this same principal (a workspace-scoped subject and role) without changing the execution engine. Organizational `Team` / Office `Role` metadata is not security RBAC.

## API keys and RBAC

- Bootstrap emits a highly sensitive root ADMIN key once.
- Store keys in secret managers; rotate using `/v1/api-keys` workflows (`ADMIN` only to list/create/revoke).
- Listing workspace API keys never returns secrets.
- Cross-workspace identifiers return `404 RESOURCE_NOT_FOUND`, not `403`.

## HTTP abuse protection

`/v1` uses Valkey fixed-window rate limits (not billing quotas): 60 requests/minute/source IP unauthenticated, 600 requests/minute/API key authenticated. Exceeding the window returns additive `429 RATE_LIMITED` with `Retry-After`. Valkey outage on protected paths fails closed as `503 SERVICE_UNAVAILABLE` (not `429`). `GET /health` and `GET /ready` are not counted. Clients and SDKs must not retry `429` indefinitely.

## Execution leases

Capability and bootstrap authorization use PostgreSQL time for persisted lease expiry. Expired or non-`RUNNING` attempts cannot start new capability operations. Legacy unleased `RUNNING` rows remain eligible until operators settle them. OSVA does not claim exactly-once external tool effects; a crash after a side effect can still fail the attempt.

## Responsible disclosure

We appreciate coordinated disclosure. OSVA does not claim formal certifications (SOC2, FedRAMP, etc.) for Community Edition.
