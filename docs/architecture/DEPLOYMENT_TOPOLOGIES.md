# Deployment Topologies

## Developer

```text
Web/API
ExecutionWorker
PostgreSQL
Redis/Valkey
```

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
