# OSVA OSS 1.0 compatibility and release policy

Target release version: **1.0.0** (release candidate prepared in-repo; public tag/publish is a separate maintainer action).

## HTTP API

- `/v1` is the stable public HTTP surface for Community Edition.
- Breaking HTTP changes require a deliberate API revision (future `/v2` or documented deprecation), not silent behavior changes.

## Public contracts

Versioned documents under `docs/contracts/` define manifests, runtime protocol messages, and gateway contracts. SDKs and adapters should track these contracts.

## Public SDKs and CLI

| Artifact | Package | Semver at 1.0 |
|----------|---------|----------------|
| Contracts | `@osva/contracts` | 1.0.0 |
| Runtime protocol | `@osva/runtime-protocol` | 1.0.0 |
| TypeScript SDK | `@osva/sdk` | 1.0.0 |
| CLI | `@osva/cli` | 1.0.0 |
| Connector SDK | `@osva/connector-sdk` | 1.0.0 |
| Python SDK | `osva-sdk` | 1.0.0 |

Semver applies to published packages. Patch/minor releases should remain compatible with the same `/v1` API unless release notes state otherwise.

## Database migrations

- Migrations are forward-only.
- Operators must run migrate jobs before or during upgrades.
- Downgrading application images without a matching schema is unsupported.

## Support windows

OSS 1.0 does not promise indefinite security or feature support windows beyond maintainer documentation and `SECURITY.md` reporting expectations.

## Enterprise features

Enterprise-only capabilities listed in the roadmap (OIDC, advanced policy, billing, etc.) are **out of scope** for Community Edition 1.0.
