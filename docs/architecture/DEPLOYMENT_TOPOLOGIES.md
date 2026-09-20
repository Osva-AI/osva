# Deployment Topologies

## Developer

```text
Web/API
ExecutionWorker
PostgreSQL
Redis/Valkey
Local filesystem artifact blobs (.osva/artifacts by default)
```

Stage 3.4 uses PostgreSQL for Artifact metadata and a configurable BlobStore (`filesystem` for single-host/shared-filesystem deployments; S3-compatible object storage recommended for multi-node production). Web and worker compose the same ArtifactApplication with independent adapter instances.

## Self-hosted production

```text
Web/API replicas
PostgreSQL
Redis/Valkey
ExecutionWorker replicas
Object storage
Optional telemetry services
```

## Kubernetes

OSS 1.0 may provide Helm-based deployment.

## Advanced

Architecture can later support multiple ExecutionWorkerPools, stronger isolation, durable workflow services, and distributed infrastructure without changing public OSVA contracts.
