# OSVA Helm chart

Production-oriented Kubernetes packaging for OSVA Community Edition. **PostgreSQL, Valkey, and S3-compatible object storage are not bundled** — provide connection details via values and Secrets.

## Prerequisites

- Kubernetes 1.27+
- Helm 3
- External PostgreSQL (pgvector), Valkey, and S3-compatible artifact bucket
- OSVA container image built from the repository root `Dockerfile`

## Install (example)

```bash
helm upgrade --install osva ./deploy/helm/osva \
  --set image.repository=your-registry/osva \
  --set image.tag=your-tag \
  --set database.url='postgres://user:pass@postgres.example:5432/osva' \
  --set valkey.url='redis://valkey.example:6379' \
  --set artifactStorage.s3.bucket=osva-artifacts \
  --set existingSecret=osva-secrets
```

Mount provider keys and S3 credentials through `existingSecret` and/or `extraEnvFrom`. Do not put secrets in `values.yaml`.

## Migration Job

The chart renders a Helm pre-install/pre-upgrade Job using the **same image tag** as application pods. It runs `migrate` only (no bootstrap).

The migration hook is **self-contained**: it does not reference the application `-env` ConfigMap or the chart-created application ServiceAccount (those are created after pre-install hooks on a fresh install).

Database URL precedence for the migration container:

1. When `existingSecret` is set, `OSVA_DATABASE_URL` must come from that Secret (and optional `extraEnvFrom`). The chart does **not** inject `database.url` into the migration Job env in that mode.
2. When `existingSecret` is empty, the migration Job sets `OSVA_DATABASE_URL` directly from `database.url`.

`extraEnv` on the migration Job is applied only when set; avoid defining `OSVA_DATABASE_URL` in `extraEnv` when using `existingSecret`.

## Container agent runtime

`worker.containerEnabled` defaults to `false`. The current `CONTAINER` runtime adapter targets Docker Engine via dockerode; normal Kubernetes nodes are not assumed to expose Docker Engine. Do not mount the Docker socket by default.

## MCP ingress hostnames

Set `mcp.allowedHosts` or enable `ingress.mcp` with a hostname so MCP DNS rebinding protection accepts production `Host` headers. `/health` is not host-filtered for probe compatibility.

## Bootstrap

Run a one-off pod or `kubectl run` with `OSVA_PROCESS=bootstrap` after migrations. This is not part of the migration hook.
