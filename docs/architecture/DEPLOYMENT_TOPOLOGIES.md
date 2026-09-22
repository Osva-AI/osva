# Deployment Topologies

## Developer

```text
Web/API
ExecutionWorker
PostgreSQL
Redis/Valkey
Local filesystem artifact blobs (.osva/artifacts by default)
```

Root `docker-compose.yml` provides PostgreSQL + Valkey for local development only. Application processes run via `pnpm` on the host.

Stage 3.4 uses PostgreSQL for Artifact metadata and a configurable BlobStore (`filesystem` for single-host/shared-filesystem deployments; S3-compatible object storage recommended for multi-node production). Web and worker compose the same ArtifactApplication with independent adapter instances.

## Self-hosted production (Compose)

```text
deploy/compose/
  PostgreSQL (pgvector) + Valkey (internal network)
  migration job (one-shot)
  Web, Worker, Scheduler, Workflow Orchestrator, Knowledge Worker, MCP Server
  shared filesystem artifact volume (single-host)
```

Uses one OSVA OCI image (`Dockerfile` at repository root) selected by `OSVA_PROCESS`. See `deploy/compose/README.md`.

## Kubernetes (Helm)

```text
External PostgreSQL (pgvector)
External Valkey
External S3-compatible artifact store
Helm release: deploy/helm/osva/
  migration Job (pre-install/upgrade hook)
  Web, Worker, Scheduler, Workflow Orchestrator, Knowledge Worker, MCP Deployments
  optional Ingress (TLS at ingress/proxy)
```

`OSVA_CONTAINER_ENABLED` defaults to **false** — the current container runtime adapter requires Docker Engine, which is not assumed on Kubernetes nodes.

## Advanced

Architecture can later support multiple ExecutionWorkerPools, stronger isolation, durable workflow services, and distributed infrastructure without changing public OSVA contracts.
