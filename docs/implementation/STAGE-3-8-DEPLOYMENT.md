# Stage 3.8 — OSS 1.0 Deployment and Release Readiness

## Progress (implementation tracker)

| Slice | Status | Notes |
|-------|--------|-------|
| 3.8.1 Deployment contract & lifecycle hardening | **Complete** | Configuration inventory, MCP host validation, knowledge worker startup checks |
| 3.8.2 Production OCI image | **Complete** | Root `Dockerfile`, pruned runtime stage, portable smoke |
| 3.8.3 Self-hosted Compose | **Complete** | `deploy/compose/` + full acceptance harness |
| 3.8.4 Helm / Kubernetes | **Complete** | `deploy/helm/osva/` + Dockerized Helm validation |
| 3.8.5 Public packages + release CI | **Complete** | `VERSION`, npm/Python pack smoke, license inventory, `release-readiness` workflow |
| 3.8.6 OSS 1.0 documentation | **Complete** | README, quickstart, operations/runbooks, security/compatibility |
| 3.8.7 Release candidate acceptance | **Complete** | Local and Linux `release-readiness` gates passed (including kind); no public publish/tag |

Stage 3.8 is **complete**: OSS 1.0 implementation and release acceptance verified (3.8.1–3.8.7). Source is versioned **1.0.0**; npm, PyPI, GHCR, and GitHub Release artifacts are published separately when operators choose to publish them.

## Decisions

- One immutable OSVA OCI image for all processes and DB CLI commands.
- PostgreSQL, Valkey, and S3-compatible storage are external in Helm; may be bundled in self-hosted Compose.
- `OSVA_CONTAINER_ENABLED` defaults to `false` in Helm (Docker Engine container runtime is not a normal Kubernetes assumption).
- Migrations run as an explicit Job/step; applications do not auto-migrate on startup.
- Bootstrap remains an explicit operator action.
- Public npm surface: `@osva/contracts`, `@osva/runtime-protocol`, `@osva/sdk`, `@osva/cli`, `@osva/connector-sdk` at version **1.0.0** aligned via root `VERSION`.

## Acceptance commands

```bash
pnpm release:version:check
node scripts/release/generate-license-inventory.mjs
OSVA_RELEASE_ACCEPTANCE=true node scripts/release/npm-pack-smoke.mjs
node scripts/release/python-pack-smoke.mjs
OSVA_DEPLOY_ACCEPTANCE=true OSVA_IMAGE=osva:1.0.0 node scripts/deployment/docker-image-smoke.mjs
OSVA_DEPLOY_ACCEPTANCE=true node scripts/deployment/deploy-compose-acceptance.mjs
node --test scripts/verification/helm-chart.test.mjs
OSVA_KIND_ACCEPTANCE=true OSVA_IMAGE=osva:1.0.0 node scripts/deployment/kind-acceptance.mjs
pnpm db:migrations:verify
pnpm release:acceptance   # orchestrates local RC checks (kind optional via OSVA_KIND_ACCEPTANCE)
```
