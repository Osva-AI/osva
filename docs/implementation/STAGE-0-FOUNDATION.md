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

Start after PostgreSQL is up, committed migrations are applied, and packages
are built:

```text
pnpm infra:up
pnpm db:migrate
pnpm build
pnpm dev:web
pnpm dev:worker
```

`pnpm dev:web` and `pnpm dev:worker` watch compiled `dist/` output. Export
`OSVA_DATABASE_URL` (and optional `OSVA_WEB_HOST` / `OSVA_WEB_PORT`) from the
environment; processes do not auto-load `.env`.

Do not apply migrations on process startup. Migrations remain explicit.

## Local infrastructure, CI, and acceptance (Slice 0.8)

Root `docker-compose.yml` runs PostgreSQL 17 and Valkey 8. There are no web or
worker containers in Stage 0. Valkey is present only so the local topology is
ready for Stage 1; application code must not connect to it.

Contributor sequence:

```text
pnpm infra:up
pnpm db:migrate
pnpm build
pnpm dev:web
pnpm dev:worker
```

`pnpm db:migrate` runs `turbo run build --filter=@osva/db` so `@osva/contracts`,
`@osva/domain`, and `@osva/db` are built in dependency order, then applies
committed SQL from `packages/db/drizzle/` using `OSVA_DATABASE_URL`.
`drizzle-kit push` is not the normal workflow. Generating new migrations
(`pnpm --filter @osva/db db:generate`) is a developer responsibility; CI does
not mutate tracked migration files. Integration tests apply the committed
history and verify the resulting schema.

GitHub Actions (`.github/workflows/ci.yml`) `verify` job runs the same root
commands as local development: `format:check`, `lint`, `typecheck`, `test`,
`build`, and `test:integration`. That job provides PostgreSQL 17 through
`OSVA_TEST_DATABASE_URL`.

A separate `compose-smoke` job starts the repository Compose topology with
`pnpm infra:up`, applies committed migrations with `pnpm db:migrate`, and
checks web `/health` and `/ready` plus idle worker start/shutdown against that
PostgreSQL. Valkey is asserted healthy as infrastructure only; Stage 0
application code does not connect to it.

See `README.md` for the concise contributor setup.

## Exit

Domain/tests compile without concrete provider/queue imports.
