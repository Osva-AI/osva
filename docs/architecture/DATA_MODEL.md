# Data Model Direction

PostgreSQL is the primary system of record.

## Core tables

Planned:

```text
workspaces
agents
agent_versions
deployments

runs
run_attempts
run_steps
run_logs

workflows
workflow_versions
workflow_runs
workflow_node_runs
approval_requests

tools
tool_versions
tool_grants

model_profiles
model_profile_versions

schedules
usage_records
artifacts
evaluation_definitions
evaluation_results

offices
teams
roles
office_workers
goals
assignments
human_tasks
```

## Stage 1 Slice 1.5 tables

Implemented:

```text
model_profiles
model_profile_versions
```

`model_profiles` is workspace-owned with unique `(workspace_id, key)`.
`model_profile_versions` references `model_profiles`, stores `provider` and
`model`, and enforces unique `(model_profile_id, version)` plus a positive
version check. These tables do not store credentials, usage, or pricing.

## Stage 2 Slice 2.1 tables

Implemented:

```text
workflows
workflow_versions
workflow_runs
workflow_node_runs
```

`workflows` is workspace-owned with unique `(workspace_id, key)`.
`workflow_versions` is an immutable append-only snapshot with unique
`(workflow_id, version)` and a JSONB graph-shaped `definition`.
`workflow_runs` references one immutable WorkflowVersion.
`workflow_node_runs` is unique on `(workflow_run_id, workflow_node_key)` and
may attach at most one canonical child `runs.id`. Slice 2.2 adds durable
`SKIPPED` status and optional `selected_target_key` for BRANCH routing
decisions. Stage 3.2 Pass 3.2.2 generalizes approval suspension to `WAITING` on both `workflow_runs` and
`workflow_node_runs`, plus `approval_requests` with unique
`(workflow_node_run_id)`. Orchestration state remains these rows plus the
immutable WorkflowVersion graph; there is no edge-execution table.

## Stage 2 Slice 2.3 tables

Implemented:

```text
approval_requests
```

`approval_requests` is workspace-owned with unique `(workspace_id, id)` and
exactly one row per APPROVAL `workflow_node_run_id`. Status is `PENDING`,
`APPROVED`, or `REJECTED`. Decision comment and `decided_at` are recorded
on resolution and then immutable. `decided_by` is not persisted because
OSVA has no durable principal identity yet.

## Stage 3.4 Run 1 tables

Implemented:

```text
artifacts
```

`artifacts` is workspace-owned immutable metadata. `digest_sha256` stores the canonical
`sha256:<hex>` integrity string (not identity). Optional `producer_run_id` and
`producer_run_attempt_id` reference the canonical RunAttempt pair. Partial unique index on
`(workspace_id, idempotency_key)` when the key is present. Blob bytes are not stored in
PostgreSQL; they use the BlobStore abstraction (Community filesystem in Run 1).

## Rules

- UTC timestamps (`timestamptz`).
- immutable version rows.
- JSONB for flexible snapshots, not for hiding important domain fields.
- historical Runs are not destructively rewritten.
- queue-engine tables are infrastructure, not product tables.

## Stage 3.5 knowledge tables (Run 1)

Implemented:

```text
knowledge_sources
knowledge_indexes
knowledge_chunks
knowledge_vectors
```

`knowledge_sources` is workspace-owned with unique `(workspace_id, key)` and
references one `artifacts` row. `knowledge_indexes` owns ingestion lifecycle
(`PENDING`, `RUNNING`, `READY`, `FAILED`), frozen pipeline configuration, and
optional `extracted_artifact_id`. `knowledge_chunks` stores canonical retrieval
text with unique `(knowledge_index_id, ordinal)`. `knowledge_vectors` is a
pgvector projection keyed by `knowledge_chunk_id`, not a domain aggregate.

## Stage 0 identifier storage

Stage 0 persists OSVA IDs as PostgreSQL `text`, not `uuid`.

Public contracts currently guarantee branded non-empty strings, not
UUID-formatted identifiers. The persistence layer must not impose a
stricter identity format than the public contract.

ID generation policy belongs outside the DB adapter. A later stage may
adopt UUID columns only if the public ID contract is tightened first.

## Stage 0 Run input

A Run owns an immutable JSON-compatible execution input snapshot,
persisted as `runs.input` JSONB. Retries and ExecutionRequest
reconstruction reuse that captured value; it is not stored on the
JobQueue payload.

A RunAttempt owns optional JSON-compatible `output` JSONB. The value is
null until the attempt succeeds, then remains immutable for that attempt.
