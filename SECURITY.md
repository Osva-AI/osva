# Security Policy

## Status

OSVA is pre-alpha and is not a hardened sandbox for arbitrary untrusted Agent code.

Early releases should be treated as suitable for development and trusted-code workloads unless release documentation says otherwise.

## Reporting vulnerabilities

Do not disclose vulnerabilities through public issues or discussions.

Use GitHub Private Vulnerability Reporting for the repository when enabled:

https://github.com/Osva-AI/osva/security/advisories/new

## Include

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
- external files and data.

Secrets are sensitive and should be represented through SecretReferences.

Safe execution of arbitrary third-party code requires stronger isolation than the initial trusted-code runtime.
