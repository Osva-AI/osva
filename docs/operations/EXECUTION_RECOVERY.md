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

A process that loses the lease must not persist terminal `SUCCEEDED`. Capability and execution-bootstrap HTTP authorization re-read persisted eligibility using **PostgreSQL `now()`**, not the worker process clock: the attempt must still be `RUNNING`, and a leased row must have `lease_expires_at > now()`. Legacy unleased `RUNNING` rows stay eligible (operators settle them manually).

Capability tokens do not carry owner/generation. A still-valid lease therefore authorizes capability HTTP even if generation later changes; that is a residual TOCTOU window, not a second lifecycle authority. Late in-flight tool/model calls that started before expiry are not recalled. OSVA does not claim exactly-once external tool effects.

Trusted TypeScript `cancel()` after lease loss would require a broader runtime lifecycle change and is **deferred**; workers still fail expired leased attempts in PostgreSQL.

Cancellation after lease loss is best-effort and cannot undo prior external side effects. Crash recovery never creates a new logical RunAttempt.

## Recovery ticker

The execution worker hosts the ticker. Multiple replicas may run it; correctness is database CAS, not leader election.

- Expired **leased** `RUNNING` attempts → `FAILED` + `EXECUTION_INTERRUPTED`
- Already-terminal rows are left unchanged
- The ticker never calls `runtime.execute()`
- `QUEUED` runs with `PENDING` attempts are re-enqueued with the **same** RunAttempt ID (BullMQ job identity). Duplicate enqueue returns `already_present` and is not counted as `osva.recovery.transport_repaired`.

## Interpreting RunAttempt diagnostics

Public RunAttempt resources may include additive `execution` diagnostics:

| Field | Meaning |
| --- | --- |
| `state` | Operator-facing summary: queued, running_leased, running_lease_expired, running_unleased, interrupted, failed, completed, cancelled, timed_out |
| `leased` | Structural: RUNNING with owner and `leaseExpiresAt` present. Not a worker-health signal. |
| `leaseExpiresAt` | Persisted PostgreSQL timestamp |
| `executionGeneration` | Fencing generation |
| `interrupted` | Attempt failed with `EXECUTION_INTERRUPTED` or allowlisted recovery reason |
| `recoveryReason` | Currently `LEASE_EXPIRED` when present |
| `observedAt` | Control-plane clock used for the observational `running_leased` / `running_lease_expired` comparison |

Recovery CAS uses PostgreSQL `now()`, not `observedAt`. Console Run Detail shows these fields and states that an expired lease is not proof a worker is down. Queue backlog is transport-only; durable status lives on the RunAttempt.

Raw `executionOwner` stays internal. VIEWER, OPERATOR, EDITOR, and ADMIN share the same GET `/v1/runs/:id/attempts/:id` READ contract, so owner identity is not exposed on the public resource.

Do not conflate a failed interrupted attempt with a new logical retry. Crash recovery never creates a subsequent RunAttempt.

## Legacy pre-migration RUNNING rows

Rows that are `RUNNING` with `execution_owner IS NULL` are **not** auto-failed. Confirm no worker still owns the attempt, then fail them with an operator UPDATE (or accept they remain `RUNNING` until manually settled). See [`UPGRADE.md`](UPGRADE.md).

## Limitations

OSVA does not claim exactly-once execution or exactly-once external effects. A crash after a tool/model side effect and before outcome persistence fails the attempt; the side effect is not rolled back.
