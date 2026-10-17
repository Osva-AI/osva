# OSVA

**Open infrastructure for AI agents, workflows, and AI workforces.**

OSVA is an open-source platform for building, running, controlling, observing, evaluating, and organizing AI agents and agentic workflows.

The project is designed as an **agent operating layer** rather than only an agent framework.

> **Status:** **OSVA Community `1.1.0-rc.2`** (release candidate — **not GA**). **`1.1.0-rc.2`** is **published** on npm (dist-tag **`rc`**), PyPI, GHCR, and GitHub Releases; npm/PyPI **`latest`** remains **`1.0.0`**. Builds on OSS 1.0 with M7–M10 developer experience work. Published **`1.1.0-rc.1`** artifacts remain on registries; **`@osva-ai/cli@1.1.0-rc.1`** lacks M10.2 agent commands — use **`1.1.0-rc.2`** from registries or build from this repository. First agent: [`examples/hello-agent/README.md`](examples/hello-agent/README.md) or `pnpm example:hello`. Start with [`docs/OSS-COMMUNITY-QUICKSTART.md`](docs/OSS-COMMUNITY-QUICKSTART.md). Registry acceptance: [`docs/release/M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](docs/release/M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md). Historical 1.0 guide: [`docs/OSS-1.0-QUICKSTART.md`](docs/OSS-1.0-QUICKSTART.md).
> Community Edition includes authenticated `/v1`, workflows, scheduling, MCP client
> and MCP server, knowledge/RAG, artifact storage, container/trusted/remote runtimes,
> TypeScript/Python SDKs, CLI, self-hosted Compose, Helm/Kubernetes packaging, optional
> OpenTelemetry, and loopback Product Console (local dev).

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

## OSS 1.0 quickstart and installation

| Path | Document |
|------|----------|
| Self-hosted Compose (recommended) | [`docs/OSS-COMMUNITY-QUICKSTART.md`](docs/OSS-COMMUNITY-QUICKSTART.md) |
| Historical OSS 1.0 quickstart | [`docs/OSS-1.0-QUICKSTART.md`](docs/OSS-1.0-QUICKSTART.md) |
| Configuration reference | [`docs/deployment/CONFIGURATION.md`](docs/deployment/CONFIGURATION.md) |
| Topologies (Compose vs Kubernetes) | [`docs/architecture/DEPLOYMENT_TOPOLOGIES.md`](docs/architecture/DEPLOYMENT_TOPOLOGIES.md) |
| Helm chart | [`deploy/helm/osva/README.md`](deploy/helm/osva/README.md) |
| Operations | [`docs/operations/RUNBOOK.md`](docs/operations/RUNBOOK.md) |
| Upgrades | [`docs/operations/UPGRADE.md`](docs/operations/UPGRADE.md) |
| Compatibility | [`docs/release/COMPATIBILITY.md`](docs/release/COMPATIBILITY.md) |

**Community Edition scope:** full control/execution plane for agents and workflows without enterprise IAM, billing, or multi-tenant SaaS packaging. **Kubernetes agent execution** is not provided: `CONTAINER` runtime targets Docker Engine on the worker host and is **disabled by default** in Helm/Compose.

**Authentication:** all `/v1/*` routes require API keys. Run bootstrap once per environment to mint the initial key.

**Public SDKs (aligned to root `VERSION`, currently `1.1.0-rc.2` on registries):** `@osva-ai/contracts`, `@osva-ai/runtime-protocol`, `@osva-ai/sdk`, `@osva-ai/cli`, `@osva-ai/connector-sdk`, and Python `osva-sdk`.

Historical Beta docs: [`docs/COMMUNITY-BETA-QUICKSTART.md`](docs/COMMUNITY-BETA-QUICKSTART.md) (legacy local dev path).

## Documentation

Start with:

1. [`docs/00-DOCUMENTATION-MAP.md`](docs/00-DOCUMENTATION-MAP.md)
2. [`docs/product/PRODUCT_VISION.md`](docs/product/PRODUCT_VISION.md)
3. [`docs/architecture/ARCHITECTURE_OVERVIEW.md`](docs/architecture/ARCHITECTURE_OVERVIEW.md)
4. [`docs/architecture/ARCHITECTURAL_INVARIANTS.md`](docs/architecture/ARCHITECTURAL_INVARIANTS.md)
5. [`docs/contracts/README.md`](docs/contracts/README.md)
6. [`docs/roadmap/IMPLEMENTATION_TRACKER.md`](docs/roadmap/IMPLEMENTATION_TRACKER.md)

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

## Local development

Two journeys are documented in [`docs/engineering/LOCAL_DEVELOPMENT.md`](docs/engineering/LOCAL_DEVELOPMENT.md):

- **External agent developer** — full stack in [`deploy/compose`](deploy/compose) plus host CLI/SDK ([`docs/OSS-COMMUNITY-QUICKSTART.md`](docs/OSS-COMMUNITY-QUICKSTART.md)).
- **OSVA contributor** — root [`docker-compose.yml`](docker-compose.yml) for PostgreSQL and Valkey only; run `apps/*` with `pnpm dev:*` from this repository.

Processes **do not auto-load** `.env`; export variables in every terminal. When using `pnpm dev:web` / `pnpm dev:worker`, set **`OSVA_TRUSTED_RUNTIME_ROOT`** and **`OSVA_ARTIFACT_FILESYSTEM_ROOT`** to **absolute paths** shared by web and worker (see the guide).

Contributor sequence: export env (including **`OSVA_KNOWLEDGE_EMBEDDING_*`** for web) → `pnpm infra:up` → `pnpm db:migrate` → `pnpm build` → `pnpm dev:*` → `pnpm db:bootstrap` → `pnpm example:hello` → Product Console ([`docs/engineering/CONSOLE.md`](docs/engineering/CONSOLE.md)). Details: [`docs/engineering/LOCAL_DEVELOPMENT.md`](docs/engineering/LOCAL_DEVELOPMENT.md).

`pnpm dev:web` and `pnpm dev:worker` watch compiled **`dist/`**; after TypeScript edits, rebuild the affected app (for example `pnpm --filter @osva/worker build`).

`pnpm test:integration` provisions ephemeral PostgreSQL via Docker
(`pgvector/pgvector:pg17`) unless you set `OSVA_TEST_DATABASE_URL` to another
pgvector-capable database. Plain local PostgreSQL without the `vector` extension
is not supported for integration tests. Valkey integration tests need a real URL
via `OSVA_TEST_VALKEY_URL`.

Do not auto-migrate during web or worker startup. Do not use `drizzle-kit push`
as the normal workflow. The committed files under `packages/db/drizzle/` are
authoritative. Generate new SQL with `pnpm --filter @osva/db db:generate` and
commit the result.

Routine infrastructure shutdown preserves volumes: `pnpm infra:down` (contributor) or `docker compose down` in `deploy/compose`. Use `docker compose down -v` only for an intentional local data wipe (see the local development guide).

### SDK and CLI

Public packages at version **`1.1.0-rc.2`** on registries (read root `VERSION`; build from this repository for unreleased commits):

- `@osva-ai/contracts`, `@osva-ai/runtime-protocol` — shared types/schemas
- `@osva-ai/sdk` — TypeScript client (`OsvaClient`) and `@osva-ai/sdk/runtime`
- `@osva-ai/cli` — `osva` CLI
- `@osva-ai/connector-sdk` — MCP connector authoring
- `osva-sdk` — Python (`from osva import OSVAClient`)

See [`docs/engineering/SDK.md`](docs/engineering/SDK.md) and [`docs/release/COMPATIBILITY.md`](docs/release/COMPATIBILITY.md).

```text
export OSVA_BASE_URL=http://127.0.0.1:3000
export OSVA_API_KEY='osva_ak_…'   # from bootstrap
pnpm --filter @osva-ai/cli build
node packages/cli/dist/bin/osva.js agents list
```

`OSVA_WORKSPACE_ID` is optional for CLI commands that use the API key; omit it or set it to the **`Workspace ID:`** printed by bootstrap.

Python checks from `sdks/python`:

```text
pip install -e ".[dev]"
ruff format --check .
ruff check .
mypy src
pytest
python -m build
```

### Endpoints and worker behavior

- `GET /health` — process liveness. Does not require PostgreSQL or Valkey.
- `GET /ready` — `200` when PostgreSQL and Valkey are reachable, `503` otherwise.

Agent Registry:

- `POST /v1/agents` — create an Agent (`key`, `name`; workspace from the API key)
- `GET /v1/agents` — list Agents
- `GET /v1/agents/:agentId` — get an Agent
- `PATCH /v1/agents/:agentId` — update Agent `name`
- `POST /v1/agents/:agentId/versions` — append an immutable AgentVersion
- `GET /v1/agents/:agentId/versions` — list versions for an Agent
- `GET /v1/agents/:agentId/versions/:agentVersionId` — get a version owned by that Agent

ModelProfile registry:

- `POST /v1/model-profiles` — create a ModelProfile (`workspaceId`, `key`, `name`)
- `GET /v1/model-profiles` — list ModelProfiles
- `GET /v1/model-profiles/:modelProfileId` — get a ModelProfile
- `PATCH /v1/model-profiles/:modelProfileId` — update ModelProfile `name`
- `POST /v1/model-profiles/:modelProfileId/versions` — append an immutable ModelProfileVersion (`provider`, `model`)
- `GET /v1/model-profiles/:modelProfileId/versions` — list versions for a ModelProfile
- `GET /v1/model-profiles/:modelProfileId/versions/:modelProfileVersionId` — get a version owned by that ModelProfile

IDs, timestamps, AgentVersion `version` numbers, and ModelProfileVersion
`version` numbers are assigned by the server. Creating an Agent, AgentVersion,
ModelProfile, or ModelProfileVersion does not execute a Run. ModelProfileVersion
stores a provider name and provider model ID; it does not store API keys.

Run lifecycle:

- `POST /v1/runs` — create a Run and its initial RunAttempt through CreateRun
- `GET /v1/runs` — list Runs with cursor pagination (`createdAt DESC`, `id DESC`)
- `GET /v1/runs/:runId` — get a persisted Run
- `GET /v1/runs/:runId/attempts` — list RunAttempts for that Run
- `GET /v1/runs/:runId/attempts/:runAttemptId` — get a nested RunAttempt

Clients cannot supply Run IDs, RunAttempt IDs, statuses, timestamps, queue
IDs, or internal `effectiveBindings`. `POST /v1/runs` accepts `agentId`,
`agentVersionId`, `input`, and optional `idempotencyKey`. Workspace comes
from the authenticated API key. OSVA
resolves the immutable `effectiveBindings` snapshot from the requested
AgentVersion, including that version's logical model bindings. Runtime
execution reuses the persisted snapshot and does not re-read AgentVersion
models. Run list query parameters are `limit` (default 50, max 100),
`cursor`, `agentId`, `agentVersionId`, and `status`. There is no public Run
or RunAttempt mutation API.

The worker is the ExecutionWorker composition root. After PostgreSQL and Valkey
are reachable and `OSVA_TRUSTED_RUNTIME_ROOT` resolves to a readable directory,
it consumes `osva-execution` through the trusted TypeScript RuntimeAdapter.
Trusted agent modules are operator-installed files beneath that root. They are
not uploaded through the HTTP API. `CreateRun` still enqueues `{ runAttemptId }`
through BullMQ. Agents call models only through `context.models.generateText`.
They do not receive OpenAI SDK clients, API keys, provider model IDs, or
ModelProfileVersion IDs. `OPENAI_API_KEY` is read only in the worker process
when composing the OpenAI provider adapter. If it is absent, the worker still
starts and model calls fail with `MODEL_PROVIDER_UNAVAILABLE`. ToolGateway is
not available to agent code.

**Knowledge (Stage 3.5):** bind immutable READY `KnowledgeIndex` IDs in the
Agent manifest under `knowledge` (logical names such as `company_docs`). CreateRun
freezes those IDs on the Run; runtime search never accepts arbitrary index IDs
from agent code. Trusted TypeScript agents call:

```ts
const hits = await context.knowledge.search(
  "company_docs",
  "What is our returns policy?",
  { topK: 3 },
);
```

Remote/container agents use the Node or Python runtime SDK
(`context.knowledge.search({ binding, query, topK })`). Retrieved chunks are
untrusted data; OSVA does not inject them into prompts automatically. See
[`docs/implementation/STAGE-3-5-KNOWLEDGE-RETRIEVAL.md`](docs/implementation/STAGE-3-5-KNOWLEDGE-RETRIEVAL.md).

Schedule API:

- `POST /v1/schedules` — create a recurring Schedule (`workspaceId`, `key`,
  `name`, `agentId`, `agentVersionId`, `cronExpression`, `timezone`, `input`,
  optional `enabled`)
- `GET /v1/schedules?workspaceId=...` — list Schedules with cursor pagination
- `GET /v1/schedules/:scheduleId` — get a Schedule
- `PATCH /v1/schedules/:scheduleId` — update mutable Schedule fields
- `GET /v1/schedules/:scheduleId/occurrences` — list materialized occurrences

Schedules use five-field cron evaluated in the configured IANA timezone.
PostgreSQL owns scheduling state. `apps/scheduler` materializes due occurrences
and dispatches canonical Runs through CreateRun; BullMQ repeatable jobs are not
the schedule authority. Community Alpha misfire policy is `COALESCE_ONE`: after
downtime at most one overdue occurrence is materialized per Schedule.

Workflow API:

- `POST /v1/workflows` — create a Workflow (`workspaceId`, `key`, `name`,
  optional `description`)
- `GET /v1/workflows` — list Workflows
- `GET /v1/workflows/:workflowId` — get a Workflow
- `POST /v1/workflows/:workflowId/versions` — append an immutable WorkflowVersion
- `GET /v1/workflows/:workflowId/versions` — list versions for a Workflow
- `GET /v1/workflows/:workflowId/versions/:workflowVersionId` — get a version
- `POST /v1/workflow-runs` — create a PENDING WorkflowRun
  (`workspaceId`, `workflowVersionId`, `input`)
- `GET /v1/workflow-runs/:workflowRunId` — get a WorkflowRun, node runs, and
  ApprovalRequests
- `GET /v1/approval-requests/:id?workspaceId=...` — get a workspace-scoped
  ApprovalRequest
- `POST /v1/approval-requests/:id/decision` — persist `APPROVED` or `REJECTED`
  (`workspaceId`, `decision`, optional `comment`); does not advance the workflow

Creating a WorkflowRun does not execute the workflow inside the HTTP request.
`apps/workflow-orchestrator` reconciles PostgreSQL WorkflowRun state, materializes
WorkflowNodeRuns, and creates canonical child Runs for AGENT nodes through
CreateRun. V1 linear AGENT graphs remain executable. V2 adds BRANCH, PARALLEL,
JOIN, and APPROVAL. Node output follows the DAG; APPROVAL is pass-through.
A failed child Run or rejected approval fails the WorkflowRun and later nodes
do not start. Agents cannot invoke other agents; multi-agent execution is
workflow composition only.

First Agent / Run walkthrough, workflow, MCP, memory, evaluation, scheduling,
AI Office, and OpenTelemetry examples live in
[`docs/COMMUNITY-BETA-QUICKSTART.md`](docs/COMMUNITY-BETA-QUICKSTART.md).

### Quality commands

```text
pnpm verify:quick
pnpm verify:ci:clean
pnpm verify:community-beta   # alias for verify:ci:clean
```

`pnpm verify:quick` is the inner development loop. `pnpm verify:ci:clean` is the
authoritative clean gate. Release-candidate checks live in
[`.github/workflows/release-readiness.yml`](.github/workflows/release-readiness.yml)
and `pnpm release:acceptance`. See `docs/engineering/DEVELOPMENT_GATES.md`.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md) before substantial changes.

## Security

See [`SECURITY.md`](SECURITY.md).

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
