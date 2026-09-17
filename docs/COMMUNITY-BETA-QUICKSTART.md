# OSVA Community Beta Quickstart

Authoritative local setup and first-use guide for **Stage 2 Community Beta**.

For capability boundaries and non-goals see [`COMMUNITY-BETA.md`](./COMMUNITY-BETA.md).

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js 24+ | `engines.node` in root `package.json` |
| pnpm 12.4.1 | via Corepack: `corepack enable` |
| Docker Compose | Recommended for PostgreSQL 17 + Valkey 8.1.10 (`pnpm infra:up`) |
| Python 3.11+ | Optional; required only for Python SDK development/verification |

Processes read configuration from the **environment**. They do not auto-load `.env`. Copy [`.env.example`](../.env.example) and export variables, or use your shell profile.

## 1. Install

```bash
git clone <repository-url>
cd osva
corepack enable
pnpm install
```

## 2. Start local infrastructure

```bash
pnpm infra:up
pnpm db:migrate
pnpm build
```

`docker-compose.yml` starts PostgreSQL and Valkey only. OSVA application processes run on the host with pnpm.

Default local credentials (development only):

```text
postgres://osva:osva@127.0.0.1:5432/osva
redis://127.0.0.1:6379
```

## 3. Configure environment

Minimum for core Community Beta:

```bash
export OSVA_DATABASE_URL=postgres://osva:osva@127.0.0.1:5432/osva
export OSVA_VALKEY_URL=redis://127.0.0.1:6379
export OSVA_TRUSTED_RUNTIME_ROOT=./trusted-runtime
export OSVA_WEB_HOST=127.0.0.1
export OSVA_WEB_PORT=3000
```

Create the trusted runtime directory and copy a fixture agent (no paid API key required):

```bash
mkdir -p trusted-runtime
cp adapters/runtime-typescript/test/fixtures/echo-agent.ts trusted-runtime/
```

Optional model providers (worker-only, never persisted):

```bash
# export OPENAI_API_KEY=...
# export ANTHROPIC_API_KEY=...
# export GOOGLE_GEMINI_API_KEY=...
```

Optional OpenTelemetry export (disabled when unset):

```bash
# export OTEL_SERVICE_NAME=osva
# export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
# export OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer replace-me
# export OTEL_SDK_DISABLED=true
```

See [`.env.example`](../.env.example) for Remote HTTP and MCP secret-reference variables.

## 4. Start OSVA services

Run each process in its own terminal after infrastructure is up and migrations applied:

```bash
pnpm dev:web
pnpm dev:worker
pnpm dev:scheduler
pnpm dev:workflow-orchestrator
```

Health endpoints on the web process:

| Endpoint | Meaning |
|----------|---------|
| `GET /health` | Process liveness (no DB/Valkey required) |
| `GET /ready` | `200` when PostgreSQL and Valkey are reachable |

Base URL for examples below: `http://127.0.0.1:3000`

## 5. First Agent and Run (no paid model key)

Use the trusted echo agent fixture. It runs entirely locally.

### Create workspace-scoped Agent

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/agents \
  -H 'Content-Type: application/json' \
  -d '{
    "workspaceId": "ws-dev",
    "key": "echo-agent",
    "name": "Echo Agent"
  }'
```

### Append immutable AgentVersion

Compute integrity for your trusted entrypoint (see `adapters/runtime-typescript` helpers) or reuse the pattern from integration tests. Minimal manifest:

```json
{
  "schemaVersion": "1",
  "key": "echo-agent",
  "name": "Echo Agent",
  "runtime": {
    "type": "TRUSTED_TYPESCRIPT",
    "entrypoint": "echo-agent.ts",
    "integrity": "<sha256-of-trusted-runtime/echo-agent.ts>"
  },
  "input": { "schema": {} },
  "output": { "schema": {} },
  "execution": { "timeoutMs": 8000, "maxAttempts": 1 },
  "capabilities": { "model": false, "tools": [] }
}
```

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/agents/<agentId>/versions \
  -H 'Content-Type: application/json' \
  -d '{ "manifest": { ... } }'
```

### Create Run and inspect state

```bash
curl -sS -X POST http://127.0.0.1:3000/v1/runs \
  -H 'Content-Type: application/json' \
  -d '{
    "workspaceId": "ws-dev",
    "agentId": "<agentId>",
    "agentVersionId": "<agentVersionId>",
    "input": { "prompt": "hello" }
  }'
```

Poll until terminal:

```bash
curl -sS http://127.0.0.1:3000/v1/runs/<runId>
curl -sS http://127.0.0.1:3000/v1/runs/<runId>/attempts/<runAttemptId>
curl -sS http://127.0.0.1:3000/v1/runs/<runId>/attempts/<runAttemptId>/steps
```

The worker consumes BullMQ jobs and executes through the trusted TypeScript runtime. RunSteps record tool/model/memory activity in PostgreSQL.

### Node SDK equivalent

```bash
export OSVA_BASE_URL=http://127.0.0.1:3000
pnpm --filter @osva/sdk build
node -e "
  import { OsvaClient } from '@osva/sdk';
  const client = new OsvaClient({ baseUrl: process.env.OSVA_BASE_URL });
  // client.agents.create(...); client.runs.create(...);
"
```

See [`docs/engineering/SDK.md`](./engineering/SDK.md).

## 6. Workflow example (two-step sequential)

Workflows are OSVA-owned definitions with immutable WorkflowVersions. Execution is reconciled by `apps/workflow-orchestrator`; child AGENT nodes create ordinary Runs.

```text
POST /v1/workflows
POST /v1/workflows/:workflowId/versions   # schemaVersion "1" linear AGENT chain
POST /v1/workflow-runs
GET  /v1/workflow-runs/:workflowRunId     # poll until SUCCEEDED
```

Minimal V1 definition (two AGENT nodes):

```json
{
  "schemaVersion": "1",
  "nodes": [
    { "key": "step-a", "type": "AGENT", "agentVersionId": "<version-a>" },
    { "key": "step-b", "type": "AGENT", "agentVersionId": "<version-b>" }
  ],
  "edges": [{ "from": "step-a", "to": "step-b" }]
}
```

Start web, worker, **and workflow-orchestrator**. Deeper DAG/approval examples: [`docs/contracts/WORKFLOW_DEFINITION_V2.md`](./contracts/WORKFLOW_DEFINITION_V2.md) and `apps/workflow-orchestrator/test/integration/`.

## 7. MCP example (local fake server)

Community Beta supports MCP beneath ToolGateway. Use the repository fake HTTP MCP server in tests as a model — no GitHub/Slack credentials required.

```text
POST /v1/connectors
POST /v1/connectors/:connectorId/versions     # kind=MCP, transport=STREAMABLE_HTTP
POST /v1/connectors/:connectorId/discover
POST /v1/connectors/import-mcp-tools
POST /v1/agents/:agentId/versions             # bind imported MCP ToolVersion
POST /v1/runs
```

Execution path: runtime → ToolGateway → MCP client → ConnectorVersion → MCP server.

Stdio MCP transport is supported for managed local child processes. Connector credentials use `SecretReference` resolved from environment variables — never stored in ConnectorVersion records.

Reference: `apps/worker/test/integration/mcp-tool-gateway.integration.test.ts`

## 8. Memory example

Persistent memory is JSON key/value through MemoryGateway.

```text
POST /v1/memory-namespaces
POST /v1/agents/:agentId/versions   # memory.store.namespaceId + access
POST /v1/runs
```

Runtime capability (logical binding name only):

```text
memory.get("store", key)
memory.set("store", key, value)
memory.list("store")
memory.delete("store", key)
```

Important semantics:

- **MemoryNamespace contents are mutable** over time.
- **AgentVersion / Run memory bindings are immutable snapshots** frozen at CreateRun.
- **Evaluation child Runs cannot mutate persistent memory by default**, even when the binding is READ_WRITE.

Reference fixture: `adapters/runtime-typescript/test/fixtures/memory-echo-agent.ts`

## 9. Evaluation example

```text
POST /v1/evaluation-suites
POST /v1/evaluation-suites/:id/versions      # cases with JSON_EXACT_MATCH evaluator
POST /v1/evaluation-runs
GET  /v1/evaluation-runs/:id                 # PASS / FAIL / ERROR per case
```

Each evaluation case executes as an **ordinary OSVA Run** through the existing worker path. There is no separate evaluation engine or LLM-as-judge.

Reference: `apps/worker/test/integration/stage-2-8-e2e.integration.test.ts`

## 10. Scheduling example

```text
POST /v1/schedules
GET  /v1/schedules/:scheduleId/occurrences
GET  /v1/runs                              # child Runs from dispatched occurrences
```

Example schedule body:

```json
{
  "workspaceId": "ws-dev",
  "key": "every-minute",
  "name": "Every Minute",
  "agentId": "<agentId>",
  "agentVersionId": "<agentVersionId>",
  "cronExpression": "* * * * *",
  "timezone": "UTC",
  "input": { "prompt": "scheduled" },
  "enabled": true
}
```

Requires `apps/scheduler` running. PostgreSQL owns schedule state; BullMQ is not the schedule authority.

## 11. AI Office example

Basic organizational layer (Stage 2.9B):

```text
POST /v1/office-workers        # links to Agent identity (OfficeWorker ≠ Agent)
POST /v1/roles                 # organizational metadata only (Role ≠ RBAC)
POST /v1/teams
POST /v1/teams/:id/memberships
POST /v1/goals
POST /v1/assignments           # freezes explicit AgentVersion or WorkflowVersion
POST /v1/assignments/:id/launch
GET  /v1/assignments/:id       # reconciles status from linked Run/WorkflowRun
```

Teams group workers; they do **not** execute. Assignments launch through existing `CreateRun` / workflow execution — no Assignment queue or worker.

Reference: `apps/worker/test/integration/stage-2-9b-assignment.integration.test.ts`

## 12. OpenTelemetry (optional)

OSVA product observability authority remains **RunStep** records in PostgreSQL.

OpenTelemetry provides optional exportable traces and metrics when configured:

```bash
export OTEL_SERVICE_NAME=osva
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
```

No observability backend is required for Community Beta. Export failure does not change Run lifecycle.

Reference: [`docs/architecture/OPENTELEMETRY.md`](./architecture/OPENTELEMETRY.md)

## 13. Verification

Development loop:

```bash
pnpm verify:quick
```

Authoritative Stage 2 release gate:

```bash
pnpm verify:ci:clean
```

Community Beta smoke integration (local/fake dependencies only):

```bash
pnpm --filter @osva/worker test:integration -- test/integration/community-beta-smoke.integration.test.ts
```

See [`docs/engineering/DEVELOPMENT_GATES.md`](./engineering/DEVELOPMENT_GATES.md).

## 14. Tear down

```bash
pnpm infra:down
```
