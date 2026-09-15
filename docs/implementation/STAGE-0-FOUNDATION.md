# Stage 0 Foundation

## Goal
Create the permanent architectural skeleton.

## Build

- pnpm TypeScript monorepo;
- apps/web shell;
- apps/worker shell;
- packages/domain;
- packages/contracts;
- packages/db;
- packages/orchestration;
- packages/runtime-core;
- test fake adapters;
- PostgreSQL local infrastructure;
- Redis local infrastructure;
- lint;
- typecheck;
- tests;
- GitHub Actions.

## Do not build

- LLM Agent behavior;
- production Tools;
- MCP;
- workflows;
- memory/RAG;
- AI Office UI;
- sandboxing.

## Persistence (Slice 0.5)

`@osva/db` implements PostgreSQL/Drizzle adapters for the Stage 0
repository ports. Schema changes are committed SQL migrations applied
explicitly; applications must not auto-migrate on startup.

Default `pnpm test` excludes PostgreSQL integration tests. Run them with
`pnpm test:integration` against a real PostgreSQL instance. The harness
prefers a temporary Docker container; if Docker is unavailable it can
start a throwaway local cluster from installed PostgreSQL binaries, or
use `OSVA_TEST_DATABASE_URL`.

Optimistic concurrency is deferred to Stage 1.

## Orchestration walking skeleton (Slice 0.6)

`@osva/orchestration` creates Runs and consumes `{ runAttemptId }`
deliveries. `@osva/runtime-core` reconstructs `ExecutionRequest` from
persisted Run, RunAttempt, and AgentVersion state. The JobQueue payload
does not carry execution context.

CreateRun validates Agent and AgentVersion ownership through
`AgentRepository` before creating or persisting a Run. PostgreSQL foreign
keys remain defense-in-depth.

CreateRun persists Run and the first RunAttempt, transitions the Run
`PENDING → QUEUED`, persists again, then enqueues `runAttemptId`. Stage 0
has no transactional outbox: if enqueue fails after that persist, durable
QUEUED/PENDING rows are left in place and CreateRun fails. Recoverability
is preferred over deleting history.

Run and RunAttempt persistence is not atomic. A failure or crash between
saving one entity and the other may leave inconsistent state. That is
deferred to Stage 1 persistence and concurrency hardening; this slice
does not introduce UnitOfWork or transactional repository ports.

A thrown RuntimeAdapter exception is converted into FAILED snapshots with
a normalized `{ code, message }` error, then returned as an
application-level failure. Arbitrary `Error` objects are not persisted.

Terminal-attempt redelivery is an idempotent no-op only when the Run
status is compatible with the terminal attempt. A RUNNING attempt is
treated as already-in-progress only when the Run is also RUNNING.
Incompatible pairs are reported as persisted-state errors and are not
silently repaired. Full crash recovery while RUNNING is deferred to
Stage 1.

Default `pnpm test` still excludes PostgreSQL. `pnpm test:integration`
covers `@osva/db` repositories, database connectivity, and a focused
orchestration walking skeleton against PostgreSQL repositories plus
in-memory JobQueue.

## Process shells (Slice 0.7)

`apps/web` is the HTTP/control-plane process. It serves `GET /health`
(liveness, no PostgreSQL) and `GET /ready` (PostgreSQL reachable). There
are no public Agent or Run APIs in Stage 0.

`apps/worker` is the future execution-worker process shell. After a
successful PostgreSQL connectivity check it stays idle until SIGTERM or
SIGINT. It does not consume a JobQueue, execute Runs, or poll PostgreSQL
for work. Cross-process execution begins in Stage 1 with BullMQ.

Start after build:

```text
OSVA_DATABASE_URL=postgres://osva@127.0.0.1:5432/osva
OSVA_WEB_HOST=127.0.0.1
OSVA_WEB_PORT=3000

pnpm --filter @osva/web start
pnpm --filter @osva/worker start
```

Do not apply migrations on process startup. Migrations remain explicit.

## Exit

Domain/tests compile without concrete provider/queue imports.
