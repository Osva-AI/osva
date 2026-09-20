# Artifact Storage Flow (Stage 3.4)

## Purpose

Create and retrieve immutable workspace-scoped Artifacts: metadata in PostgreSQL, bytes in BlobStore (filesystem or S3-compatible).

## Trigger / entry point

- **Control plane:** `POST /v1/artifacts` (multipart upload)
- **Control plane read:** `GET /v1/artifacts`, `GET /v1/artifacts/:id`, `GET /v1/artifacts/:id/content`
- **Runtime:** execution-scoped capability routes (see `RUNTIME_PROTOCOL_V1.md`)

## Step-by-step flow (create)

1. **HTTP or capability:** Stream upload body into `ArtifactApplication` (bounded by `OSVA_ARTIFACT_MAX_BYTES`).
2. **ArtifactApplication:** Validate workspace; derive runtime provenance from execution context when applicable.
3. **Allocate:** Generate `ArtifactId` and internal blob key (`v1/{artifactId}`)—never from user filenames.
4. **BlobStore:** Stream bytes; compute SHA-256; enforce max size; optional expected digest check.
5. **PostgreSQL:** Insert immutable `artifacts` row after successful blob write.
6. **Compensation:** Best-effort delete blob when metadata insert fails or idempotent replay leaves an orphan.
7. **Idempotency:** Partial unique `(workspace_id, idempotency_key)` with size/digest equivalence checks.

## Runtime flow

```text
Agent (context.artifacts)
→ capability bridge (Bearer execution token)
→ RuntimeArtifactApplication → ArtifactApplication
→ BlobStore + PostgreSQL
```

Binary bytes never travel inside Runtime Protocol V1 JSON payloads.

## Download

1. Load Artifact metadata from PostgreSQL (workspace-scoped for runtime reads).
2. Open blob by internal key; stream to client.

## State authority

| Concern | Authority |
|---------|-----------|
| Artifact lifecycle / metadata | PostgreSQL |
| Bytes | BlobStore |
| Public identity | `ArtifactId` / `ArtifactReferenceV1` only |

## Deferred

KnowledgeSource (Stage 3.5), public delete, retention, presigned URLs, cross-workspace ACLs (Stage 3.7).

## Authentication note

Community control plane enforces workspace relationships but not full tenant authentication (Stage 3.7).
