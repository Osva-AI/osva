# OSVA

**Open infrastructure for AI agents, workflows, and AI workforces.**

OSVA is an open-source platform for building, running, controlling, observing, evaluating, and organizing AI agents and agentic workflows.

The project is designed as an **agent operating layer** rather than only an agent framework.

> **Status:** pre-alpha. Stage 1 Slice 1.4 adds a trusted TypeScript
> RuntimeAdapter. `apps/worker` consumes `osva-execution` through BullMQ when
> PostgreSQL, Valkey, and `OSVA_TRUSTED_RUNTIME_ROOT` are ready. This runtime
> executes operator-installed TypeScript modules; it is not an untrusted
> sandbox.

## Why OSVA?

Building one agent is becoming easy. Operating many agents reliably is not.

OSVA aims to provide a common operating layer for questions such as:

- Which AgentVersion is running?
- What triggered a Run?
- Which model, ToolVersion, and configuration did it actually use?
- What happened during execution?
- Why did it fail?
- How much did it cost?
- Can it be paused, retried, or rolled back?
- Did its output pass evaluation?
- Can a human approve sensitive actions?
- How do multiple Agents participate in one Workflow?
- How can Agents become reusable OfficeWorkers inside an AI Office?

## Product direction

```text
Agent operating layer
    ↓
Agent management platform
    ↓
Workflow and multi-agent platform
    ↓
AI Office
    ↓
AI workforce operating system
```

## Architectural philosophy

OSVA is built around several long-term rules:

1. **Stable product concepts, replaceable infrastructure.**
2. **Control plane and execution plane remain separate.**
3. **Executed behavior is versioned and reproducible.**
4. **OSVA remains framework-neutral.**
5. **Deterministic software is preferred where AI is unnecessary.**
6. **Tools and model access are explicitly governed.**
7. **The public contracts belong to OSVA, not an infrastructure vendor.**
8. **Early implementation choices must be upgradeable without changing core product concepts.**

## Major platform areas

```text
Experience
  Web UI · CLI · SDK · API · Webhooks

Control Plane
  Agents · Versions · Workflows · Tools · Models · Evals · Policy

Orchestration
  Triggers · Runs · Scheduling · Approvals · Durable workflows

Execution
  ExecutionWorkers · RuntimeAdapters · Node · Python · Containers · Remote runtimes

Intelligence
  ModelGateway · ToolGateway · Memory · Knowledge

Quality
  Logs · Traces · Usage · Cost · Evaluations

AI Office
  OfficeWorkers · Teams · Roles · Goals · Assignments
```

## Open-source roadmap

- **Stage 0:** contracts and architectural foundation
- **Stage 1:** Community Alpha and complete Agent execution loop
- **Stage 2:** Community Beta with multiple runtimes, workflows, MCP, and multi-agent composition
- **Stage 3:** OSS 1.0 with stable extension contracts, durable workflow support, container execution, and production deployment
- **Post-1.0:** deeper AI Office, isolation, policy, scalability, and ecosystem capabilities

See [`docs/roadmap/STAGE_ROADMAP.md`](docs/roadmap/STAGE_ROADMAP.md).

## Documentation

Start with:

1. [`docs/00-DOCUMENTATION-MAP.md`](docs/00-DOCUMENTATION-MAP.md)
2. [`docs/product/PRODUCT_VISION.md`](docs/product/PRODUCT_VISION.md)
3. [`docs/architecture/REFERENCE_ARCHITECTURE.md`](docs/architecture/REFERENCE_ARCHITECTURE.md)
4. [`docs/architecture/ARCHITECTURAL_INVARIANTS.md`](docs/architecture/ARCHITECTURAL_INVARIANTS.md)
5. [`docs/contracts/README.md`](docs/contracts/README.md)
6. [`docs/implementation/STAGE-0-FOUNDATION.md`](docs/implementation/STAGE-0-FOUNDATION.md)

## Initial implementation direction

Stage 1 is expected to use:

- TypeScript
- Node.js
- pnpm
- PostgreSQL
- Redis/Valkey
- BullMQ behind the `JobQueue` contract
- Docker
- separate control-plane and ExecutionWorker processes

These are implementation choices, not permanent domain dependencies.

## Stage 0 Development

Stage 0 is the architectural foundation: public contracts, domain, PostgreSQL
persistence, a walking orchestration skeleton, and process shells. It is not a
usable Agent product. Deeper notes live in
[`docs/implementation/STAGE-0-FOUNDATION.md`](docs/implementation/STAGE-0-FOUNDATION.md)
and [`docs/roadmap/IMPLEMENTATION_TRACKER.md`](docs/roadmap/IMPLEMENTATION_TRACKER.md).

### Prerequisites

- Node.js 24
- pnpm 12.4.1 through Corepack (`corepack enable`)
- Docker Compose for the normal local topology (PostgreSQL 17 plus Valkey)

The Compose credentials (`osva` / `osva` / `osva`) are local-development defaults
only. They are not production-safe.

If Docker is unavailable, `pnpm test:integration` can still use installed
PostgreSQL 17 binaries or `OSVA_TEST_DATABASE_URL`, and a real Valkey URL via
`OSVA_TEST_VALKEY_URL`. Those are test fallbacks, not the documented contributor
path.

### Setup

```text
git clone <repository-url>
cd osva
corepack enable
pnpm install
```

Copy `.env.example` to `.env` as a reference, or set the same variables in the
environment. Processes do not auto-load `.env`. Required variables:

- `OSVA_DATABASE_URL`
- `OSVA_VALKEY_URL`
- `OSVA_TRUSTED_RUNTIME_ROOT`
- optional `OSVA_WEB_HOST` / `OSVA_WEB_PORT`

Then start infrastructure, apply committed migrations, and run the apps:

```text
pnpm infra:up
pnpm db:migrate
pnpm build
pnpm dev:web
pnpm dev:worker
```

Required sequence:

```text
start PostgreSQL and Valkey
    ↓
apply committed migrations
    ↓
start applications
```

Do not auto-migrate during web or worker startup. Do not use `drizzle-kit push`
as the normal workflow. The committed files under `packages/db/drizzle/` are
authoritative. Generate new SQL with `pnpm --filter @osva/db db:generate` and
commit the result.

`pnpm infra:up` starts PostgreSQL 17 and Valkey 8.1.10. Web and worker both
require `OSVA_DATABASE_URL` and `OSVA_VALKEY_URL`.

### Endpoints and worker behavior

- `GET /health` — process liveness. Does not require PostgreSQL or Valkey.
- `GET /ready` — `200` when PostgreSQL and Valkey are reachable, `503` otherwise.

Agent Registry:

- `POST /v1/agents` — create an Agent (`workspaceId`, `key`, `name`)
- `GET /v1/agents` — list Agents
- `GET /v1/agents/:agentId` — get an Agent
- `PATCH /v1/agents/:agentId` — update Agent `name`
- `POST /v1/agents/:agentId/versions` — append an immutable AgentVersion
- `GET /v1/agents/:agentId/versions` — list versions for an Agent
- `GET /v1/agents/:agentId/versions/:agentVersionId` — get a version owned by that Agent

IDs, timestamps, and AgentVersion `version` numbers are assigned by the server.
Creating an Agent or AgentVersion does not execute a Run.

Run lifecycle:

- `POST /v1/runs` — create a Run and its initial RunAttempt through CreateRun
- `GET /v1/runs` — list Runs with cursor pagination (`createdAt DESC`, `id DESC`)
- `GET /v1/runs/:runId` — get a persisted Run
- `GET /v1/runs/:runId/attempts` — list RunAttempts for that Run
- `GET /v1/runs/:runId/attempts/:runAttemptId` — get a nested RunAttempt

Clients cannot supply Run IDs, RunAttempt IDs, statuses, timestamps, queue
IDs, or internal `effectiveBindings`. `POST /v1/runs` accepts `workspaceId`,
`agentId`, `agentVersionId`, `input`, and optional `idempotencyKey`. OSVA
resolves the immutable `effectiveBindings` snapshot from the requested
AgentVersion. Run list query parameters are `limit` (default 50, max 100),
`cursor`, `agentId`, `agentVersionId`, and `status`. There is no public Run
or RunAttempt mutation API.

The worker is the ExecutionWorker composition root. After PostgreSQL and Valkey
are reachable and `OSVA_TRUSTED_RUNTIME_ROOT` resolves to a readable directory,
it consumes `osva-execution` through the trusted TypeScript RuntimeAdapter.
Trusted agent modules are operator-installed files beneath that root. They are
not uploaded through the HTTP API. `CreateRun` still enqueues `{ runAttemptId }`
through BullMQ. ModelGateway and ToolGateway are not available to agent code.

### Quality commands

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
pnpm infra:down
```

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md) before substantial changes.

## Security

See [`SECURITY.md`](SECURITY.md).

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
