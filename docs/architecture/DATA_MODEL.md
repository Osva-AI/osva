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

## Rules

- UUID primary IDs.
- UTC timestamps.
- immutable version rows.
- JSONB for flexible snapshots, not for hiding important domain fields.
- historical Runs are not destructively rewritten.
- queue-engine tables are infrastructure, not product tables.
