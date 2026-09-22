# Backup and recovery (OSS 1.0)

## PostgreSQL (required)

PostgreSQL stores OSVA product state: Runs, Workflows, Agents, schedules, knowledge metadata, API keys, and migration history.

- Take regular logical or volume backups using your standard PostgreSQL tooling (`pg_dump`, managed service snapshots, etc.).
- Recovery requires restoring PostgreSQL **before** pointing a new OSVA version at the cluster unless you intentionally start fresh.
- Test restores periodically.

## Artifact storage

When artifact retention matters, back up the artifact store:

- **Filesystem mode (Compose):** back up the shared artifact volume path (`OSVA_ARTIFACT_FILESYSTEM_ROOT`).
- **S3-compatible mode (recommended production):** use bucket versioning/replication per your object-store practices.

## Valkey

Valkey is **not** the durable semantic authority, but it is **not** casually disposable:

- Queued and in-flight BullMQ messages may be lost if Valkey data is wiped without draining workers.
- After Valkey loss, restart workers and inspect Runs/WorkflowRuns for stuck attempts; replay policies depend on workflow/run state.

Prefer Valkey persistence (AOF/RDB) or managed Redis/Valkey backups when you require stronger transport durability.

## Secrets

OSVA expects secrets via environment variables or Kubernetes Secrets (`OSVA_DATABASE_URL`, provider API keys, S3 credentials, etc.).

- OSVA does not back up external secret stores.
- Document secret rotation separately from application upgrades.
