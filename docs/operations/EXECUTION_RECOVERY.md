# Execution recovery (M9.3)

PostgreSQL remains the lifecycle authority. BullMQ is transport. Workers acquire an execution lease when they CAS a RunAttempt from `PENDING` to `RUNNING`.

## Legacy runs (checkpointing off)

For agents **without** durable checkpointing (or when the feature is disabled in the manifest): expired lease recovery behaves as before. The ticker fails **the same** RunAttempt with `FAILED` + `EXECUTION_INTERRUPTED`. OSVA does **not** create a successor `RunAttempt` for ordinary lease expiry on these runs. Queue **redelivery** after a worker crash still reuses the **same** `RunAttemptId` (transport idempotency); that is not a new logical attempt.

## Opt-in checkpoint recovery (Declarative)

**Checkpoint resume** is **opt-in** per AgentVersion: `runtime.config.checkpointingEnabled` (and compatible runtime). It also requires migration **`0031_agent_checkpoint_resume_slice`** so PostgreSQL can store checkpoints, the run operation journal, and the `INTERRUPTED` run status (see [`UPGRADE.md`](UPGRADE.md)).

When checkpointing is enabled **and** the operation journal is wired:

1. **Lease expiry while `RUNNING`:** The Run moves to **`INTERRUPTED`** (non-terminal) instead of failing the attempt in place, **provided** recovery can prove it is safe to resume from the latest durable checkpoint.
2. **Successor attempts:** Manual **`POST /v1/runs/:runId/resume`** (operator) or **automatic** recovery (when `automaticRecoveryEnabled` is true on the agent) schedules a **new** logical **`RunAttempt`** with a **new** `RunAttemptId`. That successor replays from checkpoint state; it is **not** BullMQ queue redelivery of the interrupted attempt.
3. **Unsafe / uncertain operations:** If the journal contains a **pending** tool operation whose idempotency class is **unknown or non-idempotent** (`UNKNOWN_WRITE`, or similar) and the outcome is not **`COMMITTED`**, automatic recovery **does not** schedule a successor until an operator resolves the ambiguity (domain reason such as `RECOVERY_BLOCKED_UNCERTAIN_OPERATION`). Manual resume remains subject to the same eligibility checks.
4. **Queue redelivery vs recovery:** BullMQ **stall** / **retry** delivery for the **same** job still targets the **same** `RunAttemptId`. **Checkpoint recovery** deliberately creates a **new** attempt id — do not conflate the two.

**Upgrade note (leases):** Lease columns and lease expiry scanning require migration **`0023_execution_lease_slice`**, introduced after git tag **`v1.0.0`** (which ends at **`0022_api_security_slice`**). See [`UPGRADE.md`](UPGRADE.md) before rolling workers that host the recovery ticker.

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

Cancellation after lease loss is best-effort and cannot undo prior external side effects. **Without** checkpointing, lease-driven interruption does not introduce a successor `RunAttempt`. **With** checkpoint recovery enabled, a **separate** successor attempt may be scheduled only after eligibility checks (see above).

## Recovery ticker

The execution worker hosts the ticker. Multiple replicas may run it; correctness is database CAS, not leader election.

- Expired **leased** `RUNNING` attempts:
  - **Checkpoint-eligible** Declarative runs (latest durable checkpoint present, repositories wired): the attempt is failed with `EXECUTION_INTERRUPTED` and the Run becomes **`INTERRUPTED`** so a successor attempt can be scheduled when eligible.
  - **Otherwise (legacy):** the attempt is failed with `FAILED` + `EXECUTION_INTERRUPTED` **in place**; the Run does not enter `INTERRUPTED` for automatic checkpoint resume.
- Already-terminal rows are left unchanged
- The ticker never calls `runtime.execute()` for recovery
- **`INTERRUPTED` runs:** a second pass may enqueue a **new** successor `RunAttempt` when automatic recovery is enabled and journal safety allows (see [Opt-in checkpoint recovery](#opt-in-checkpoint-recovery-declarative) above).
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

Distinguish **BullMQ redelivery** (same `RunAttemptId`) from **checkpoint recovery** (new successor `RunAttemptId` when opt-in checkpointing and eligibility allow it).

## Legacy pre-migration RUNNING rows

Rows that are `RUNNING` with `execution_owner IS NULL` are **not** auto-failed. Confirm no worker still owns the attempt, then fail them with an operator UPDATE (or accept they remain `RUNNING` until manually settled). See [`UPGRADE.md`](UPGRADE.md).

## Limitations

OSVA does not claim exactly-once execution or exactly-once external effects. A crash after a tool/model side effect and before outcome persistence fails the attempt; the side effect is not rolled back.
