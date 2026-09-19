# File Catalog

Architecturally significant files only (~50). Use as canonical precedents when implementing features.

| File | Responsibility | Called by / used by | Important dependencies | Architectural notes |
|------|----------------|---------------------|------------------------|-------------------|
| `apps/web/src/process.ts` | Control-plane composition root | `main.ts` | domain apps, Postgres repos, BullMQ, CreateRun | Wires persist-then-enqueue; no execution |
| `apps/web/src/http.ts` | HTTP router assembly | `process.ts` | all `*-http.ts` handlers | Single API surface |
| `apps/web/src/run-http.ts` | Run CRUD API | HTTP router | CreateRun, RunApplication | POST /v1/runs entry |
| `apps/web/src/workflow-http.ts` | Workflow + WorkflowRun API | HTTP router | WorkflowApplication | Creates WorkflowRuns |
| `apps/web/src/evaluation-http.ts` | EvaluationSuite/Run API | HTTP router | EvaluationSuiteApplication, EvaluationRunApplication | Starts evaluation coordination |
| `apps/web/src/office-http.ts` | AI Office API | HTTP router | OfficeApplication, LaunchAssignment | Assignment launch reuses CreateRun |
| `apps/worker/src/process.ts` | Execution-plane composition root | `main.ts` | gateways, runtime adapters, ExecuteRunAttempt | Full gateway + capability server wiring |
| `apps/worker/src/execute-run-attempt-handler.ts` | BullMQ handler wrapper | worker consume loop | ExecuteRunAttempt, EvaluationCoordinator | Post-terminal evaluation hook |
| `apps/worker/src/worker.ts` | Queue consumer lifecycle | `process.ts` | JobQueue | Readiness + graceful shutdown |
| `apps/workflow-orchestrator/src/process.ts` | Workflow orchestrator wiring | `main.ts` | ReconcileWorkflowRun | Separate reconciliation process |
| `apps/workflow-orchestrator/src/loop.ts` | Poll + reconcile loop | `process.ts` | WorkflowOrchestratorTick | PostgreSQL authority |
| `apps/scheduler/src/process.ts` | Scheduler wiring | `main.ts` | SchedulerTick | Cron → CreateRun |
| `packages/orchestration/src/create-run.ts` | Persist-then-enqueue Run creation | web, workflow reconciler, scheduler, evaluation | RunRepository, JobQueue | Freezes effective bindings; queue never creates attempts |
| `packages/orchestration/src/execute-run-attempt.ts` | RunAttempt execution service | worker handler | RuntimeAdapter, createExecutionRequest | Terminal persistence; adapter errors → FAILED |
| `packages/orchestration/src/reconcile-workflow-run.ts` | DAG workflow reconciler | workflow-orchestrator | CreateRun, WorkflowRunRepository | AGENT nodes only create Runs; APPROVAL durable |
| `packages/orchestration/src/evaluation-coordinator.ts` | Post-terminal evaluation hook | worker handler | ReconcileEvaluationCase | Thin coordinator, not execution engine |
| `packages/orchestration/src/scheduler-tick.ts` | Schedule occurrence processing | scheduler | DispatchScheduleOccurrence | Idempotent occurrence dispatch |
| `packages/orchestration/src/launch-assignment.ts` | Assignment launch orchestration | web office-http | CreateRun, ReconcileAssignment | No Assignment queue; idempotent Run link |
| `packages/orchestration/src/reconcile-assignment.ts` | Assignment status from Run/WorkflowRun | web GET assignment | RunRepository, WorkflowRunRepository | Derived lifecycle only |
| `packages/domain/src/office-application.ts` | AI Office CRUD + invariants | web office-http | OfficeRepository | Workspace isolation; Role is metadata |
| `packages/db/src/repositories/postgres-office-repository.ts` | AI Office persistence | web, orchestration | office schema tables | PostgreSQL canonical |
| `packages/domain/src/run.ts` | Run aggregate | CreateRun, ExecuteRunAttempt | EffectiveRunBindings | Owns frozen bindings snapshot |
| `packages/domain/src/run-attempt.ts` | RunAttempt aggregate | CreateRun, ExecuteRunAttempt | — | Canonical attempt identity |
| `packages/domain/src/run-state-machine.ts` | Run transitions | Run aggregate, ExecuteRunAttempt | — | PENDING→QUEUED→RUNNING→terminal |
| `packages/domain/src/run-attempt-state-machine.ts` | Attempt transitions | RunAttempt aggregate | — | Mirrors execution progress |
| `packages/domain/src/effective-run-bindings.ts` | Immutable binding snapshot | Run.create | — | model/tool/memory bindings frozen at CreateRun |
| `packages/domain/src/workflow-definition.ts` | V1/V2 definition validation | WorkflowVersion | — | DAG graph building input |
| `packages/domain/src/workflow-run-state-machine.ts` | WorkflowRun transitions | reconciler | — | Includes WAITING and CANCELLED |
| `packages/domain/src/evaluation-run-application.ts` | EvaluationRun lifecycle | web, domain | EvaluationSuiteRepository | Starts child Runs via CreateRun |
| `packages/domain/src/memory-application.ts` | Memory namespace CRUD | web | MemoryNamespaceRepository | Control-plane only |
| `packages/runtime-core/src/create-execution-request.ts` | Build ExecutionRequest from DB state | ExecuteRunAttempt, capability bridge | Run, RunAttempt, AgentVersion | Includes evaluationContext when present |
| `packages/runtime-core/src/runtime-dispatcher.ts` | Select runtime by AgentVersion | worker | RuntimeAdapter implementations | Runtime from manifest, not workflow node |
| `packages/runtime-core/src/execution-id.ts` | executionId helpers | runtime adapters | — | Maps to RunAttemptId |
| `packages/model-gateway/src/model-gateway.ts` | Model mediation | worker, run-step recorder | ModelProfileRepository, provider adapters | Loads immutable ModelProfileVersion |
| `packages/tool-gateway/src/tool-gateway.ts` | Tool mediation + policy | worker, run-step recorder | ToolRepository, ToolPolicy, MCP executor | MCP branch when type=MCP |
| `packages/tool-gateway/src/internal/mcp-tool-executor.ts` | MCP invoke via ConnectorVersion | ToolGateway | McpClientPool, ConnectorRepository | Beneath ToolGateway |
| `packages/tool-gateway/src/policy/default-tool-policy.ts` | Default authorization rules | ToolGateway | — | Server-side permissions |
| `packages/memory-gateway/src/memory-gateway.ts` | Memory mediation | worker, run-step recorder | MemoryNamespaceRepository | Evaluation read-only via allowPersistentMutation |
| `packages/observability/src/run-step-recorder.ts` | RunStep + usage/cost recording | worker capability wiring | gateways, RunRepository | Wraps gateway calls |
| `packages/observability/src/instrumentation.ts` | Optional span/metric helpers | adapters-opentelemetry, orchestration | — | Auxiliary to RunStep authority |
| `adapters/opentelemetry/src/opentelemetry-instrumentation.ts` | OTLP SDK wiring | worker/web when enabled | OpenTelemetry SDK | Disabled by default |
| `adapters/bullmq/src/bullmq-job-queue.ts` | BullMQ JobQueue adapter | web, worker, orchestrator | bullmq | Payload is runAttemptId only |
| `adapters/bullmq/src/job-id.ts` | BullMQ job ID encoding | bullmq-job-queue | — | Not an OSVA identity |
| `adapters/runtime-typescript/src/trusted-typescript-runtime-adapter.ts` | Trusted TS runtime | worker RuntimeDispatcher | child-runner | In-process capabilities |
| `adapters/runtime-typescript/src/child-runner.ts` | Child process IPC | trusted-typescript adapter | protocol.ts | Agent code isolation |
| `adapters/runtime-http/src/remote-http-runtime-adapter.ts` | Remote HTTP execute POST | worker RuntimeDispatcher | outbound-network | Synchronous; no remote lifecycle |
| `adapters/runtime-http/src/capability-bridge.ts` | Capability HTTP → gateways | capability-server | ModelGateway, ToolGateway, MemoryGateway | Re-enters OSVA mediation |
| `adapters/runtime-http/src/capability-server.ts` | HTTP capability endpoints | worker process | capability-bridge | Token-scoped per execution |
| `adapters/model-openai/src/openai-provider-adapter.ts` | OpenAI provider | ModelGateway | OpenAI SDK | Adapter boundary |
| `adapters/model-anthropic/src/anthropic-provider-adapter.ts` | Anthropic provider | ModelGateway | Anthropic SDK | Adapter boundary |
| `adapters/model-gemini/src/gemini-provider-adapter.ts` | Gemini provider | ModelGateway | Google SDK | Adapter boundary |
| `adapters/mcp-client/src/index.ts` | MCP client pool factory | web (discovery), worker (execute) | MCP transports | Per ConnectorVersion reuse |
| `packages/db/src/database.ts` | DB connection factory | all apps | drizzle | — |
| `packages/db/src/schema/runs.ts` | Run table schema | migrations, repos | — | effectiveBindings persisted |
| `packages/db/src/schema/run-attempts.ts` | RunAttempt table schema | migrations, repos | — | — |
| `packages/db/src/schema/run-steps.ts` | RunStep table schema | migrations, repos | — | Observability |
| `packages/db/src/schema/workflow-runs.ts` | WorkflowRun schema | migrations, repos | — | Lifecycle authority |
| `packages/db/src/schema/workflow-node-runs.ts` | WorkflowNodeRun schema | migrations, repos | — | Per-node state |
| `packages/db/src/repositories/postgres-run-repository.ts` | Run persistence | CreateRun, ExecuteRunAttempt | mappers | Expected-state updates |
| `packages/db/src/repositories/postgres-workflow-run-repository.ts` | WorkflowRun persistence | reconciler | mappers | — |
| `packages/db/src/repositories/postgres-evaluation-suite-repository.ts` | Evaluation persistence | evaluation apps | mappers | Immutable case results |
| `packages/contracts/src/job-queue.ts` | JobQueue port | orchestration, adapters | RunAttemptId | Transport contract |
| `packages/contracts/src/run-state.ts` | Run/Attempt state types | domain, contracts | — | Public state machine types |
| `packages/contracts/src/runtime-protocol.ts` | Runtime protocol types | runtime-protocol pkg | — | executionId = RunAttemptId |
| `packages/contracts/src/model-gateway.ts` | ModelGateway port | model-gateway | — | No provider SDK types |
| `packages/contracts/src/tool-gateway.ts` | ToolGateway port | tool-gateway | — | — |
| `packages/contracts/src/memory-gateway.ts` | MemoryGateway port | memory-gateway | — | Authorization shape |
| `packages/sdk/src/client.ts` | OsvaClient entry | CLI, external users | HTTP /v1 | Public SDK surface |
| `packages/cli/src/bin/osva.ts` | CLI entry | shell | @osva/sdk | No parallel HTTP impl |
| `scripts/verification/verify.mjs` | Verification harness | package.json scripts | turbo, prettier | verify:quick / verify:ci:clean |
