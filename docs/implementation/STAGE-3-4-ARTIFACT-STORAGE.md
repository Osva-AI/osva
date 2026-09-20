# Stage 3.4 Artifact Storage

Stage 3.4 delivers Community Artifact storage for the control plane and runtimes.

## Architecture

- **PostgreSQL** stores immutable Artifact metadata (lifecycle authority).
- **ArtifactBlobStore** stores opaque bytes only (`filesystem` or S3-compatible).
- **ArtifactApplication** coordinates validation, streaming upload, digest, idempotency, and compensation.
- **HTTP** exposes multipart create, metadata read, list, and streaming download.
- **Runtimes** create/read Artifacts through execution-scoped capability endpoints (binary side channel), not Runtime Protocol V1 JSON bodies.
- **Knowledge** (KnowledgeSource, parsing, retrieval) is intentionally deferred to Stage 3.5.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `OSVA_ARTIFACT_STORAGE_DRIVER` | `filesystem` | `filesystem` or `s3` |
| `OSVA_ARTIFACT_FILESYSTEM_ROOT` | `.osva/artifacts` | Local blob root (single-host / shared filesystem deployments) |
| `OSVA_ARTIFACT_MAX_BYTES` | `67108864` | Streaming upload limit |
| `OSVA_ARTIFACT_S3_*` | — | S3-compatible backend (recommended for multi-node production) |

## Upload pipeline

```text
HTTP or runtime capability (multipart / streamed body)
→ ArtifactApplication.create
→ ArtifactBlobStore (streamed write)
→ PostgreSQL metadata insert
```

File bytes are not assembled into a single Artifact-sized buffer in the control plane. Maximum size is enforced while streams flow.

## Runtime capability transport

Runtime Protocol V1 JSON remains limited (including the existing body-size cap). Artifact bytes use dedicated capability routes:

```text
POST /v1/runtime/capabilities/artifacts/create   (multipart)
POST /v1/runtime/capabilities/artifacts/get      (JSON metadata)
GET  /v1/runtime/capabilities/artifacts/content  (streamed bytes)
```

Trusted TypeScript uses IPC chunking to the worker parent, which forwards to the same ArtifactApplication semantics.

## Idempotency

Control-plane and runtime idempotency keys identify **one immutable creation**. Runtime caller keys are scoped per RunAttempt (`artifact-runtime:<RunAttemptId>:<callerKey>`). Reuse with matching workspace, metadata, size, and SHA-256 returns the existing Artifact; mismatches yield `ArtifactIdempotencyConflictError`.

## Runtime authorization (Community)

An active execution may read an Artifact only when it belongs to the **same workspace** as the execution. Cross-workspace reads fail with `ARTIFACT_WORKSPACE_MISMATCH`. Finer policy belongs to Stage 3.7.

## Deployment

| Backend | Use when |
|---------|----------|
| **Filesystem** | Developer machines, single host, or explicit shared filesystem between web/worker |
| **S3-compatible** | Production, Kubernetes, or any multi-node layout (AWS S3, R2, MinIO, etc.—subset of S3 API OSVA uses) |

Do not treat local filesystem as safe for arbitrary distributed deployments without shared storage.

## Authentication note

Community HTTP APIs enforce workspace relationships but do not yet provide full tenant authentication. Strong authorization belongs to Stage 3.7.
