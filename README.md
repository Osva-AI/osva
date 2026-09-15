# OSVA

**Open infrastructure for AI agents, workflows, and AI workforces.**

OSVA is an open-source platform for building, running, controlling, observing, evaluating, and organizing AI agents and agentic workflows.

The project is designed as an **agent operating layer** rather than only an agent framework.

> **Status:** pre-alpha. The architecture and public contracts are being established before implementation.

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

## Stage 0 local processes

`apps/web` is the control-plane HTTP shell. `apps/worker` is the future
execution-worker shell. They are not connected by a queue in Stage 0.

Required environment:

```text
OSVA_DATABASE_URL=postgres://osva@127.0.0.1:5432/osva
```

Optional web bind address (defaults `127.0.0.1:3000`):

```text
OSVA_WEB_HOST=127.0.0.1
OSVA_WEB_PORT=3000
```

```text
pnpm --filter @osva/web build
pnpm --filter @osva/web start

pnpm --filter @osva/worker build
pnpm --filter @osva/worker start
```

Web endpoints: `GET /health` (process liveness) and `GET /ready`
(PostgreSQL reachable). The Stage 0 worker does not execute queued work.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md) before substantial changes.

## Security

See [`SECURITY.md`](SECURITY.md).

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
