# Execution recovery (M9.3)

PostgreSQL remains the lifecycle authority. BullMQ is transport. Workers acquire an execution lease when they CAS a RunAttempt from `PENDING` to `RUNNING`. Expired ownership fails **the same** RunAttempt with `FAILED` + `EXECUTION_INTERRUPTED`. OSVA never automatically re-executes a `RUNNING` attempt and never creates a subsequent logical RunAttempt for crash recovery.

## Lease fields

| Column | Role |
| --- | --- |
| `execution_owner` | Winning worker identity |
| `execution_generation` | Fencing token (starts at 1 on acquire) |
| `lease_expires_at` | Server-side expiry (`now()` + TTL) |

Lease expiry and heartbeat renewal use PostgreSQL `now()`, not worker clocks.

## Heartbeat

| Variable | Default | Notes |
| --- | --- | --- |
| `OSVA_EXECUTION_LEASE_TTL_MS` | `30000` | Must exceed the heartbeat interval |
| `OSVA_EXECUTION_HEARTBEAT_INTERVAL_MS` | `10000` | Only the current owner may renew |
| `OSVA_EXECUTION_RECOVERY_POLL_MS` | `5000` | Worker-hosted ticker |
| `OSVA_EXECUTION_RECOVERY_BATCH_LIMIT` | `50` | Expired RUNNING scan |
| `OSVA_TRANSPORT_REPAIR_BATCH_LIMIT` | `50` | QUEUED/PENDING repair |

A process that loses the lease must not persist terminal `SUCCEEDED`. Capability calls for an expired leased attempt are rejected. Cancellation after lease loss is best-effort and cannot undo prior external side effects.

## Recovery ticker

The execution worker hosts the ticker. Multiple replicas may run it; correctness is database CAS, not leader election.

- Expired **leased** `RUNNING` attempts → `FAILED` + `EXECUTION_INTERRUPTED`
- Already-terminal rows are left unchanged
- The ticker never calls `runtime.execute()`
- `QUEUED` runs with `PENDING` attempts are re-enqueued with the **same** RunAttempt ID (BullMQ job identity). Duplicate enqueue is a no-op.

## Legacy pre-migration RUNNING rows

Rows that are `RUNNING` with `execution_owner IS NULL` are **not** auto-failed. Confirm no worker still owns the attempt, then fail them with an operator UPDATE (or accept they remain `RUNNING` until manually settled). See [`UPGRADE.md`](UPGRADE.md).

## Limitations

OSVA does not claim exactly-once execution or exactly-once external effects. A crash after a tool/model side effect and before outcome persistence fails the attempt; the side effect is not rolled back.
