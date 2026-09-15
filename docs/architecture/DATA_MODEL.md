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

## Rules

- UTC timestamps (`timestamptz`).
- immutable version rows.
- JSONB for flexible snapshots, not for hiding important domain fields.
- historical Runs are not destructively rewritten.
- queue-engine tables are infrastructure, not product tables.

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
