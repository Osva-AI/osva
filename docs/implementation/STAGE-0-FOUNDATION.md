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

## Exit

Domain/tests compile without concrete provider/queue imports.
