# Stage 2 Community Beta

## Build

- ✅ Slice 2.1: versioned sequential Workflow execution
  (`Workflow` / immutable `WorkflowVersion` / `WorkflowRun` /
  `WorkflowNodeRun`, linear AGENT graphs, durable PostgreSQL
  reconciliation, child Runs through the existing execution path);
- ✅ Slice 2.2: branch/parallel/join DAG orchestration
  (`schemaVersion: "2"`, durable `SKIPPED`, skip propagation,
  concurrent ready AGENT nodes, process-level workflow-orchestrator E2E);
- ✅ Slice 2.3: multi-agent composition and durable APPROVAL
  (different AGENT nodes bind different immutable AgentVersions; human
  approval is a workflow orchestration primitive with ApprovalRequest;
  no direct agent-to-agent runtime API);
- ✅ Slice 2.4: Runtime Protocol V1 and Remote HTTP runtime
  (ExecutionWorker dispatches through RuntimeDispatcher; trusted TypeScript
  remains one RuntimeAdapter; remote HTTP is synchronous Protocol V1 with
  executionId = RunAttemptId and an OSVA capability bridge);
- ✅ Slice 2.5: Node SDK, Python SDK, CLI, and public SDK surface
  (`@osva/sdk`, `@osva/cli`, `osva-sdk`; control-plane clients over `/v1`;
  Runtime Protocol V1 runtime helpers; shared fixtures; Python CI);
- ✅ Slice 2.6: additional model providers
  (Anthropic direct API and Google Gemini Developer API behind ModelGateway;
  synchronous text generation only; OpenAI unchanged);
- ✅ Slice 2.7: MCP client and connector foundation
  (versioned `Connector` / immutable `ConnectorVersion`; Streamable HTTP and
  stdio transports; explicit MCP tool discovery into immutable MCP
  `ToolVersion` snapshots; execution only through ToolGateway);
- ✅ Slice 2.8: Memory namespaces and EvaluationSuites
  (durable JSON key/value memory through MemoryGateway; immutable
  EvaluationSuiteVersion; EvaluationRun coordinates ordinary child Runs;
  evaluation child Runs cannot mutate persistent memory by default);
- ✅ Slice 2.9A: OpenTelemetry foundation (optional OTLP traces/metrics;
  RunStep remains durable observability authority; BullMQ trace propagation);
- ✅ Slice 2.9B: basic AI Office entities (OfficeWorker, Role, Team,
  TeamMembership, Goal, Assignment; assignment launch reuses CreateRun/workflow
  execution; explicit immutable AgentVersion/WorkflowVersion targets);
- ✅ Slice 2.9C: Community Beta readiness packaging (quickstart, capability
  matrix, smoke test, final verification).

Workflow Definition remains pre-1.0 but versioned.

## Slice 2.1

Stage 2.1 adds the smallest durable workflow kernel:

```text
Workflow
  → immutable WorkflowVersion
  → WorkflowRun
  → sequential WorkflowNodeRuns
  → canonical child Run
  → canonical RunAttempt
  → existing BullMQ / ExecutionWorker path
```

Sequential data flow is:

```text
WorkflowRun.input → first node input
node N output → node N+1 input
final node output → WorkflowRun.output
```

PostgreSQL is workflow lifecycle authority. `apps/workflow-orchestrator`
reconciles persisted WorkflowRun state. BullMQ transports child RunAttempts
and is not the workflow state machine.

Slice 2.1 does not implement branches, parallel execution, approvals,
expression languages, workflow retries, TOOL/HTTP/MCP nodes, or a visual
builder.

## Slice 2.2

Stage 2.2 upgrades the sequential reconciler into a durable DAG reconciler
without replacing the Stage 2.1 architecture:

```text
persisted PostgreSQL state
  → derive ready / skippable / failed nodes
  → idempotent WorkflowNodeRun transitions
  → canonical child Runs for AGENT nodes only
  → persist results
  → reconcile again
```

V1 sequential definitions remain executable. V2 adds `BRANCH`, `PARALLEL`,
and `JOIN`. Only AGENT nodes create canonical Runs. Inactive branch paths
are durably `SKIPPED`. JOIN aggregates succeeded predecessors by node key
in definition order. Fail-fast workflow failure does not cancel in-flight
sibling Runs and cannot be overwritten by later sibling success.

Slice 2.2 does not implement approvals, pause/resume, cancellation,
workflow retries, loops, expression languages, TOOL/HTTP/MCP nodes, or a
visual builder.

## Slice 2.3

Stage 2.3 formalizes OSVA multi-agent behavior as workflow composition and
adds a durable `APPROVAL` orchestration node.

Different AGENT nodes on one immutable WorkflowVersion may reference
different immutable AgentVersions. Handoff, routing, fan-out, fan-in, and
human gates happen only through WorkflowRun / WorkflowNodeRun. The trusted
runtime does not expose agent invocation, spawning, or messaging APIs.

When an APPROVAL node is ready, PostgreSQL records one ApprovalRequest and
the WorkflowNodeRun becomes `WAITING_FOR_APPROVAL`. BullMQ is not used as
the waiting mechanism. Humans decide through
`POST /v1/approval-requests/:id/decision`. The API persists `APPROVED` or
`REJECTED` only; `apps/workflow-orchestrator` reconciles the decision.
Approved nodes pass input through unchanged. Rejected nodes fail the
WorkflowRun with `APPROVAL_REJECTED`. `WAITING_FOR_APPROVAL` on the
WorkflowRun means human input is the actual remaining blocker.

`decidedBy` is omitted because OSVA has no durable principal identity yet.

Slice 2.3 does not implement approval expiration, assignment, quorum,
rejection branches, revision loops, tool-call approval, Node/Python/HTTP
runtimes, MCP, or a visual builder.

## Slice 2.4

Stage 2.4 introduces a stable runtime execution boundary so trusted
TypeScript is one RuntimeAdapter rather than the only runtime model.

```text
ExecutionWorker
  → RuntimeDispatcher
  → TrustedTypeScriptRuntimeAdapter | RemoteHttpRuntimeAdapter
```

Runtime choice is immutable AgentVersion state. Workflows and approvals stay
runtime-agnostic. Remote HTTP speaks Runtime Protocol V1: one synchronous
POST, `executionId` = RunAttemptId, no automatic HTTP retries, no remote job
lifecycle. Remote model/tool calls go through the OSVA capability bridge to
ModelGateway and ToolGateway. Outbound REMOTE_HTTP destinations default to
public networks only; private destinations require worker operator opt-in.

Slice 2.4 does not implement Node/Python SDKs, streaming, async remote jobs,
HTTP retry policy, runtime failover, or a runtime registry.

## Slice 2.7

Stage 2.7 adds a versioned connector foundation and MCP client adapter beneath
the existing ToolGateway. MCP is an integration protocol, not an alternate
execution path around OSVA policy, permissions, lifecycle, or immutable
bindings.

```text
Connector
  → immutable ConnectorVersion (kind=MCP, transport, transportConfig, auth refs)
  → explicit control-plane discovery
  → OSVA Tool + immutable MCP ToolVersion snapshot
  → AgentVersion tool binding
  → Runtime / capability bridge
  → ToolGateway permission checks
  → MCP execution adapter
  → ConnectorVersion
  → external MCP server
  → normalized ToolResult / RunStep observability
```

Supported MCP transports in Community Beta slice 2.7:

- `STREAMABLE_HTTP` (remote MCP HTTP endpoint)
- `STDIO` (managed local MCP child process, reused per ConnectorVersion)

Supported MCP surface:

- tool discovery (`tools/list` equivalent)
- tool execution (`tools/call` equivalent)

Discovery is control-plane behavior (`POST .../discover`,
`POST /v1/connectors/import-mcp-tools`). Execution always uses the immutable
ToolVersion snapshot bound on the AgentVersion. Remote MCP schema changes create
new ToolVersions; existing AgentVersions keep their prior snapshots.

Credentials resolve through existing `SecretReference` + `SecretResolver`
patterns (environment-backed in Community Edition). Plaintext secrets are not
persisted in ConnectorVersion records, Runtime Protocol, logs, or tool results.

Slice 2.7 does not implement MCP resources, prompts, sampling, roots,
elicitation/input-required interaction, MCP Tasks, subscriptions, OAuth flows,
legacy SSE as an OSVA connector transport, OSVA-as-MCP-server, provider-specific
connectors, runtime-direct MCP APIs, or a connector marketplace.

## Slice 2.8

Stage 2.8 adds durable JSON key/value memory namespaces and immutable
EvaluationSuites that execute through the existing Run path.

```text
AgentVersion memory binding
  → MemoryGateway
  → MemoryNamespace
  → MemoryRecord
  → PostgreSQL
```

Memory namespace contents may change over time, but AgentVersion memory
bindings are immutable execution snapshots frozen on CreateRun. Runtimes use
logical binding names only; they never receive namespace database IDs or SQL.

EvaluationSuites are control-plane definitions with immutable versions and
cases. An EvaluationRun coordinates one ordinary child Run per case through
the existing queue and ExecutionWorker. PASS/FAIL/ERROR are case outcomes,
not EvaluationRun infrastructure failure.

Evaluation child Runs may read bound memory according to AgentVersion access
but cannot mutate persistent memory by default, even when the binding is
READ_WRITE. Normal Runs retain full binding permissions.

Slice 2.8 does not implement vector memory, semantic search, RAG, LLM-as-judge
evaluators, dataset import, tool mocks, or a separate evaluation execution
engine.

## Slice 2.9A

Stage 2.9A adds optional OpenTelemetry export without changing Run lifecycle
authority. RunStep records in PostgreSQL remain the durable product observability
source. OTLP traces and metrics are auxiliary and disabled by default.

## Slice 2.9B

Stage 2.9B adds basic AI Office organizational entities: OfficeWorker, Role,
Team, TeamMembership, Goal, and Assignment. Assignment is the only object that
connects to execution; it freezes an explicit AgentVersion or WorkflowVersion and
launches through existing CreateRun / workflow paths. No Assignment queue,
worker, or workforce planner.

## Slice 2.9C

Stage 2.9C packages Community Beta readiness: authoritative quickstart,
environment documentation, capability matrix, non-goals, architecture doc sync,
Community Beta smoke integration test, and final `pnpm verify:ci:clean` gate.
