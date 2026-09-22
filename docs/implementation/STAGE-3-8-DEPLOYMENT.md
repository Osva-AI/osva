# Stage 3.8 — OSS 1.0 Deployment and Release Readiness

## Progress (implementation tracker)

| Slice | Status | Notes |
|-------|--------|-------|
| 3.8.1 Deployment contract & lifecycle hardening | **Implemented (acceptance hardening)** | Configuration inventory, MCP host validation, knowledge worker startup checks |
| 3.8.2 Production OCI image | **Implemented (acceptance hardening)** | Root `Dockerfile`, pruned runtime stage, portable smoke |
| 3.8.3 Self-hosted Compose | **Implemented (acceptance hardening)** | `deploy/compose/` + full acceptance harness |
| 3.8.4 Helm / Kubernetes | **Implemented (acceptance hardening)** | `deploy/helm/osva/` + Dockerized Helm validation |
| 3.8.5 | Not started | |
| 3.8.6 | Not started | OSS 1.0 documentation overhaul |
| 3.8.7 | Not started | Final release acceptance |

Stage 3.8 is **not** complete and OSS 1.0 is **not** released.

## Decisions

- One immutable OSVA OCI image for all processes and DB CLI commands.
- PostgreSQL, Valkey, and S3-compatible storage are external in Helm; may be bundled in self-hosted Compose.
- `OSVA_CONTAINER_ENABLED` defaults to `false` in Helm (Docker Engine container runtime is not a normal Kubernetes assumption).
- Migrations run as an explicit Job/step; applications do not auto-migrate on startup.
- Bootstrap remains an explicit operator action.
