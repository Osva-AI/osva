# Canonical dependency adoption example

OSS 1.0 reference workflow built only from existing OSVA platform capabilities: three Agents, Workflow Definition V3 orchestration, knowledge RAG, MCP tools beneath ToolGateway, native approval, durable EVENT wait, WorkflowEvent resume, and artifact generation.

## Milestone status

| Milestone | Status |
| --- | --- |
| M1 contracts / scaffold | Complete |
| M2 npm MCP connector | Complete |
| M3 Trusted TS agents | Complete |
| M4 setup / bootstrap | Complete |
| M5 operator / run scripts | Complete |
| M6 deterministic E2E | Not implemented |

## Agent responsibilities

| Agent | Role | Runtime capabilities |
| --- | --- | --- |
| **Research** | Evidence | `primary` model + `policy_docs` knowledge + npm MCP tools |
| **Analysis** | Judgment | `primary` model + `policy_docs` knowledge |
| **Report** | Communication | `primary` model + artifacts |

Research gathers policy and npm evidence and synthesizes findings/warnings only (no adoption decision). Analysis evaluates evidence against ExampleCo policy. Report renders approved analysis to Markdown and stores one OSVA Artifact.

Bootstrap via `pnpm run canonical:setup` registers model, policy knowledge, MCP tools, AgentVersions, and a WorkflowVersion. M5 operator commands create and inspect live WorkflowRuns against that stack. A deterministic full E2E harness is M6 (not implemented yet).

## What this demonstrates

| Capability | Status |
| --- | --- |
| Workflow V3 (AGENT → APPROVAL → WAIT → AGENT) | Live WorkflowVersion via setup |
| Research / Analysis / Report agents | Trusted TS entrypoints + live runs |
| Policy RAG | KnowledgeIndex via setup + live agent runs |
| npm MCP connector | stdio connector + live tool execution on worker |
| Human approval | Approval API via `canonical:approve` |
| EVENT wait + delivery resume | WorkflowEvent via `canonical:emit-delivery-event` |
| Markdown artifact | Report agent + artifact API |

## Workflow

```text
Research
  → Analysis
  → Approval
  → Delivery event wait
  → Report
```

Orchestration keys: `research`, `analysis`, `adoption-approval`, `delivery-wait`, `report`.

## npm connector (M2)

The canonical example includes a read-only MCP connector (`canonical-npm-research`) that exposes:

- `npm_package_metadata` — normalized registry metadata
- `npm_downloads` — normalized download counts for `last-month`

Execution path:

```text
Research Agent → runtime tool capability → ToolGateway → MCP Connector → npm public API
```

Build and run stdio locally:

```powershell
pnpm --filter @osva/example-canonical-dependency-adoption build
pnpm --filter @osva/example-canonical-dependency-adoption mcp:stdio
```

Compiled stdio entrypoint: `dist/mcp/npm-connector/stdio.js`.

## Trusted TypeScript agents (M3)

Each agent module exports `async function run(context)` for the Trusted TypeScript runtime adapter.

Compiled entrypoints (after `build`):

```text
dist/agents/research-agent.js
dist/agents/analysis-agent.js
dist/agents/report-agent.js
```

M4 setup will copy these under `OSVA_TRUSTED_RUNTIME_ROOT/canonical-dependency-adoption/` with SHA-256 integrity.

Logical capability bindings expected in AgentManifest (future setup):

| Agent | Model | Knowledge | Tools |
| --- | --- | --- | --- |
| Research | `primary` | `policy_docs` | `npm_package_metadata`, `npm_downloads` |
| Analysis | `primary` | `policy_docs` | — |
| Report | `primary` | — | — (artifacts capability) |

When stdio MCP connectors are registered with OSVA, relevant processes need:

```text
OSVA_MCP_STDIO_CONNECTORS_ENABLED=true
```

## Why the request envelope is preserved

V3 passes each node’s output as the successor’s input. APPROVAL and EVENT WAIT are pass-through, so Analysis output (including `request` and `research`) flows unchanged until Report runs. The delivery WAIT correlates external events with:

```json
{
  "correlation": {
    "kind": "INPUT_POINTER",
    "pointer": "/request/requestId"
  }
}
```

If Research or Analysis dropped `request`, wait correlation and reporting would break.

## Architecture boundaries

- **Agents execute** model/tool/memory/knowledge/artifact work through OSVA runtime capabilities only.
- **APPROVAL / WAIT orchestrate** lifecycle; they do not create Runs or mutate the envelope.
- **MCP** sits beneath ToolGateway and never bypasses it.
- **PostgreSQL** is durable authority for workflow and run lifecycle.
- **BullMQ / Valkey** is transport only.

## Local setup state

`examples/canonical-dependency-adoption/.osva/canonical-state.json` stores convenience metadata (for example the pinned `workflowVersionId`). It is **not** execution authority—PostgreSQL remains canonical. Operator commands verify the referenced WorkflowVersion still exists before creating a WorkflowRun.

## Setup (M4)

From the repository root (after OSVA web/worker/knowledge-worker are running):

```powershell
pnpm --filter @osva/example-canonical-dependency-adoption build
pnpm run canonical:setup
```

### Setup script environment

| Variable | Required by setup |
| --- | --- |
| `OSVA_BASE_URL` | yes |
| `OSVA_API_KEY` | yes |
| `OSVA_WORKSPACE_ID` | yes |
| `OSVA_TRUSTED_RUNTIME_ROOT` | yes (same root configured on the worker) |
| `OSVA_CANONICAL_MODEL_PROVIDER` | optional (default `OPENAI`) |
| `OSVA_CANONICAL_MODEL` | optional (default `gpt-4.1-mini` when provider is OpenAI) |

Setup does **not** need provider secret values. It only creates the ModelProfileVersion metadata binding.

### OSVA service environment (not read directly by setup)

| Variable | Services |
| --- | --- |
| `OSVA_MCP_STDIO_CONNECTORS_ENABLED=true` | web (discover/import), worker (tool execution) |
| Provider credentials (e.g. OpenAI) | worker (model calls) |
| Artifact filesystem / storage config | web + worker (artifact API backend) |
| Knowledge embedding configuration | knowledge-worker (index build) |

Local convenience state is written to `.osva/canonical-state.json` (gitignored). PostgreSQL remains authoritative.

### Setup rerun semantics

- Mutable parents (`ModelProfile`, `Connector`, `Agent`, `Workflow`, `KnowledgeSource`) are reused when listed by stable keys.
- Immutable versions are reused only when local state still verifies (resource GET succeeds, knowledge index is `READY`, deployed agent digests and MCP stdio path unchanged).
- Changed agent bytes or MCP entrypoint path creates new ConnectorVersion / AgentVersion / WorkflowVersion rows on the next setup run.
- Setup never deletes durable OSVA resources on failure.

## Operator workflow (M5)

Build once, then use root commands from the repository root:

```powershell
pnpm --filter @osva/example-canonical-dependency-adoption build
```

### Environment (operator commands)

| Variable | Required |
| --- | --- |
| `OSVA_BASE_URL` | yes |
| `OSVA_API_KEY` | yes |
| `OSVA_WORKSPACE_ID` | yes |

Operator commands read `.osva/canonical-state.json` for the WorkflowVersion id created by setup. They do **not** recreate setup infrastructure.

### Runtime prerequisites (live WorkflowRun execution)

Unlike setup alone, executing the workflow requires:

- **web**, **worker**, **workflow-orchestrator**, **PostgreSQL**, and **Valkey**
- KnowledgeIndex from setup still **READY** (Research/Analysis RAG)
- `OSVA_MCP_STDIO_CONNECTORS_ENABLED=true` on the **worker** (MCP tools)
- Worker configured with the same `OSVA_TRUSTED_RUNTIME_ROOT`, model provider credentials, and compatible artifact storage as setup

### Start a review

```powershell
pnpm canonical:run --package zod --use-case "Runtime validation for TypeScript backend services"
```

Optional repeated constraints:

```powershell
pnpm canonical:run `
  --package zod `
  --use-case "Runtime validation for TypeScript backend services" `
  --constraint "Must be suitable for production" `
  --constraint "Prefer permissive licensing"
```

`canonical:run` creates the WorkflowRun and returns immediately (no polling).

### Inspect status

```powershell
pnpm canonical:status <workflowRunId>
```

Status is a **view** over persisted OSVA API data (WorkflowRun, node runs, approvals, child Runs). It does not invent lifecycle state client-side.

### Approve or reject

```powershell
pnpm canonical:approve <workflowRunId> --comment "Proceed with the report."
pnpm canonical:approve <workflowRunId> --reject --comment "License risk is unresolved."
```

The decision persists through the ApprovalRequest API; the workflow orchestrator reconciles asynchronously afterward.

### Emit delivery signal

```powershell
pnpm canonical:emit-delivery-event <requestId>
```

Optional convenience when the workflow run id is easier to copy:

```powershell
pnpm canonical:emit-delivery-event --workflow-run <workflowRunId>
```

WorkflowEvents are durable. OSVA accepts an event **before** the delivery WAIT node arms; once the workflow reaches that WAIT, an eligible early event can satisfy it. Example order:

```text
canonical:run
canonical:emit-delivery-event <requestId>
…
canonical:approve <workflowRunId>
```

### Inspect final state

```powershell
pnpm canonical:status <workflowRunId>
```

M5 live acceptance on a real stack is performed separately after implementation; M6 adds deterministic automated E2E coverage.

Compiled operator entrypoints:

```text
dist/scripts/run.js
dist/scripts/status.js
dist/scripts/approve.js
dist/scripts/emit-delivery-event.js
```

## Package layout

```text
contracts/     Frozen JSON Schemas (v1)
workflow/      Reference dependency-adoption.v3.json
knowledge/     Example company policy for RAG
agents/src/    Trusted TypeScript agents
mcp/           npm MCP connector (stdio)
scripts/       setup + M5 operator commands (`setup.ts`, `run.ts`, …)
test/          Contract, workflow, connector, and agent tests
```

## Development

From the repository root:

```powershell
pnpm --filter @osva/example-canonical-dependency-adoption build
pnpm --filter @osva/example-canonical-dependency-adoption test
pnpm --filter @osva/example-canonical-dependency-adoption typecheck
```

See `contracts/README.md` for envelope and schema details.

### Downloads period semantics

`npm_downloads` accepts `period: "last-month"` only. The connector calls the npm downloads API **point** endpoint; `start` / `end` in tool output come from npm’s response.
