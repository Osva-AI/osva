# Security Policy

## Status

OSVA **OSS 1.0** Community Edition is intended for production-style self-hosting when operators follow deployment hardening guidance. It is still **not a arbitrary-code sandbox**: trusted and container runtimes require explicit operator configuration and isolation choices.

Release candidate builds are verified in CI but **not** publicly tagged until maintainers approve release publication.

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

## API keys

- Bootstrap emits a highly sensitive root key once.
- Store keys in secret managers; rotate using `/v1/api-keys` workflows.

## Responsible disclosure

We appreciate coordinated disclosure. OSVA does not claim formal certifications (SOC2, FedRAMP, etc.) for Community Edition.
