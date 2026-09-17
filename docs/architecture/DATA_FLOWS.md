# Data Flows

Index of major OSVA execution flows after Stage 2.8.

## run-execution

**Purpose:** Create and execute a single agent Run through terminal lifecycle.

**Entry point:** `POST /v1/runs` → `CreateRun` → BullMQ → `ExecuteRunAttempt`

**Main components:** `apps/web`, `CreateRun`, `BullMqJobQueue`, `apps/worker`, `RuntimeDispatcher`, PostgreSQL

**State authority:** PostgreSQL (Run, RunAttempt, RunStep). BullMQ is transport only.

**Detailed flow:** [flows/run-execution.md](./flows/run-execution.md)

## workflow-execution

**Purpose:** Execute a WorkflowVersion as a durable WorkflowRun with AGENT, BRANCH, PARALLEL, JOIN, and APPROVAL nodes.

**Entry point:** `POST /v1/workflow-runs` → `apps/workflow-orchestrator` reconciliation loop

**Main components:** `ReconcileWorkflowRun`, `WorkflowNodeRun`, child `CreateRun`, approval API

**State authority:** PostgreSQL (WorkflowRun, WorkflowNodeRun, ApprovalRequest)

**Detailed flow:** [flows/workflow-execution.md](./flows/workflow-execution.md)

## model-call

**Purpose:** Agent runtime invokes a bound model through ModelGateway to a provider adapter.

**Entry point:** Runtime capability (trusted TS or remote HTTP bridge)

**Main components:** `RunStepRecorder`, `ModelGateway`, provider adapters, `RunStep`

**State authority:** PostgreSQL for RunStep and usage; provider is stateless

**Detailed flow:** [flows/model-call.md](./flows/model-call.md)

## tool-call

**Purpose:** Agent runtime invokes a bound internal tool through ToolGateway.

**Entry point:** Runtime capability → `ToolGateway.invoke`

**Main components:** `DefaultToolPolicy`, internal registry, `RunStepRecorder`

**State authority:** PostgreSQL for RunStep; tool side effects are executor-defined

**Detailed flow:** [flows/tool-call.md](./flows/tool-call.md)

## mcp-tool-call

**Purpose:** Agent runtime invokes an MCP ToolVersion through ToolGateway and MCP client adapter.

**Entry point:** Runtime capability → `ToolGateway.invoke` (type=MCP)

**Main components:** `invokeMcpToolVersion`, `ConnectorVersion`, MCP client pool

**State authority:** PostgreSQL for ToolVersion/ConnectorVersion snapshots and RunStep

**Detailed flow:** [flows/mcp-tool-call.md](./flows/mcp-tool-call.md)

## memory-access

**Purpose:** Agent runtime reads/writes durable JSON memory through MemoryGateway.

**Entry point:** Runtime capability → `MemoryGateway.get/set/list/delete`

**Main components:** effective memory bindings, `MemoryNamespaceRepository`, optimistic revision

**State authority:** PostgreSQL (MemoryNamespace, MemoryRecord)

**Detailed flow:** [flows/memory-access.md](./flows/memory-access.md)

## evaluation-run

**Purpose:** Coordinate EvaluationSuite cases as ordinary child Runs and aggregate results.

**Entry point:** `POST /v1/evaluation-runs` → child `CreateRun` per case

**Main components:** `EvaluationRunApplication`, `EvaluationCoordinator`, `ReconcileEvaluationCase`

**State authority:** PostgreSQL (EvaluationRun, EvaluationCaseResult). No separate worker.

**Detailed flow:** [flows/evaluation-run.md](./flows/evaluation-run.md)

## Supporting flows (no dedicated doc)

| Flow | Entry | Notes |
|------|-------|-------|
| Schedule tick | `apps/scheduler` | Cron → `SchedulerTick` → `CreateRun` |
| MCP discovery | `POST /v1/connectors/.../discover` | Control plane; creates ToolVersion snapshots |
| Run observability | `GET /v1/runs/:id/steps` | Read-only RunStep API |
