# OSVA Console (`apps/console`)

`apps/web` is the OSVA public control-plane API. `apps/console` is the browser-based developer/operator product console.

The console never connects to PostgreSQL directly and never exposes the workspace API key to the browser. The browser talks only to the console origin; the console server holds `OSVA_CONSOLE_API_KEY` and calls `apps/web` `/v1` endpoints through `@osva-ai/sdk`.

## Required environment

| Variable | Purpose |
| --- | --- |
| `OSVA_CONSOLE_API_KEY` | Workspace API key used server-side only |
| `OSVA_BASE_URL` | Control plane base URL (default `http://127.0.0.1:3000`) |
| `OSVA_CONSOLE_HOST` | Console bind host (default `127.0.0.1`) |
| `OSVA_CONSOLE_PORT` | Console bind port (default `4174`) |

`OSVA_API_BASE_URL` is accepted as an alias for `OSVA_BASE_URL`.

## Run locally

1. Start infrastructure and the control plane (`apps/web`) with a valid API key.
2. Build or run the console:

```bash
pnpm --filter @osva/console build
OSVA_CONSOLE_API_KEY=<key> pnpm --filter @osva/console start
```

Development (Vite + console API server):

```bash
OSVA_CONSOLE_API_KEY=<key> pnpm dev:console
```

Open the Vite dev URL (default `http://127.0.0.1:5173`). API calls are proxied to the console server.

## Security model

- API key stays on the console server process.
- Console API routes are an explicit allowlist (no generic HTTP proxy).
- Responses are checked so the configured key cannot leak in JSON payloads.
- Workflow builder drafts may be stored in **workspace-scoped `sessionStorage`** for authoring recovery only. Drafts never contain API keys or other secrets.

## Supported surfaces

### Runs (read)

- Runs list with filters and cursor pagination
- Run detail, attempts, steps, usage
- Artifact metadata, on-demand safe text/JSON preview (512 KiB cap), and streamed original-byte download via the Console BFF
- Polling while runs/attempts are active

### Workflows (read)

- Workflow registry list and detail
- Immutable workflow version definitions (V1/V2/V3)
- Recent workflow runs per workflow

**Workflow version detail** (`/workflows/:workflowId/versions/:workflowVersionId`):

- **Definition (graph)** — read-only visualization for **schema version 3** only. The graph is rendered with `@xyflow/react` (pan/zoom; no editing). Graph code is **lazy-loaded** so the main console bundle does not include React Flow until a V3 version page opens the graph section.
- **Definition (structured)** — topologically ordered node list with per-type summaries (accessible alternative to the canvas).
- **Definition (JSON)** — full immutable definition payload as returned by the API.

V1 and V2 versions omit the graph section (message only) and still show the structured list and JSON.

### Workflow runs (read + operator actions)

- Workflow run list and detail
- Approval decisions and workflow event ingestion (role-gated)

### Workflow creation (M8.3.1 + M8.3.2)

**Route:** `/workflows/new` (linked from the Workflows list).

**Capabilities:**

- Create a workflow registry row (`key`, `name`, optional `description`)
- Build a **Workflow Definition V3** draft on an **interactive graph canvas** (all V3 node types: AGENT, BRANCH, PARALLEL, JOIN, APPROVAL, WAIT)
- Connect nodes with edges, drag to arrange layout, and configure nodes in the **inspector** or **accessible node list**
- Discover workspace agents and bind **immutable AgentVersion** ids on each AGENT node
- Publish the draft as a new immutable `WorkflowVersion` via the control plane

**Draft model:**

- The executable draft is a canonical `WorkflowDefinitionV3` (`nodes` + `edges`) in client state
- Canvas layout (`layoutByNodeKey`) is kept separate and is **not** sent to the API
- Node keys are stable sequence-based ids (for example `agent-step-1`, `branch-2`)
- Workspace-scoped `sessionStorage` recovery (M8.3.1) with explicit restore; partial publish retry retains `workflowId`

**Publish behavior:**

- A **publish review** step shows key, name, node/edge counts, node types, agent bindings, and validation before confirmation
- Registry creation and version publication are separate API calls
- If registry creation succeeds but version publication fails, the UI retains `workflowId`, shows partial-success messaging, and allows **retry publish** without creating a duplicate workflow
- Successful publish clears the workspace draft from `sessionStorage` and navigates to the new version page
- Published versions are never rewritten

**Validation (M8.3.3):**

- Live structured report (graph, node, and edge issues) with focus actions and inspector details
- Client-side Zod shape checks and **domain DAG validation** (`@osva/domain`) remain the canonical publish gate
- Invalid intermediate graphs remain editable; publish confirmation is disabled until the definition is valid
- Control plane errors are shown separately from client validation and include request IDs

**Execution (M8.3.4 + M8.4.1):**

- Published WorkflowVersion pages expose **Run workflow**: JSON input, client-side syntax check, explicit confirm, then `POST /api/v1/workflow-runs` (BFF → `POST /v1/workflow-runs`)
- The launch form resolves the published definition's single root node. If that root is an AGENT, it loads `manifest.input.schema` from the existing `/api/v1/agents/:agentId/versions` catalog and displays that contract. Valid JSON is not presented as executable input.
- Empty-object schemas remain valid (`{}`). Non-AGENT roots, multiple roots, and missing/unavailable schemas are explained without inventing a contract. Safe examples are prefilled only from JSON Schema `const`/`default` values — required business fields are never fabricated.
- The BFF never exposes OSVA API credentials; control-plane EXECUTE + workspace isolation remain authoritative
- Successful create navigates to the returned WorkflowRun
- WorkflowRun detail overlays persisted `WorkflowNodeRun.status` on the read-only V3 graph, keyed by `workflowNodeKey`
- Multiple records for one key use the latest `sequence` / `updatedAt`; earlier WorkflowNodeRun records are listed as historical node records, not RunAttempts or automatic retries
- Definition nodes without a WorkflowNodeRun are shown as **NO RECORD**, not PENDING or SUCCEEDED
- BRANCH edges use persisted `selectedTargetKey` (selected vs inactive). SKIPPED targets use persisted SKIPPED records. Topology never implies a selected path
- PARALLEL children and JOIN predecessors are listed from persisted neighbor records only
- WAITING approval/wait copy states that the workflow is suspended and workers are not kept alive
- Selecting a node reuses the existing execution card (approval decision, event emit, child Run link)
- WorkflowRun detail shows Waiting + Execution (graph), then Related artifacts, then Input/Output so persisted execution state is the primary surface
- Active runs continue to poll via TanStack Query (`ACTIVE_RUN_POLL_MS`); terminal runs do not
- Product demo sequence: `docs/product/CONSOLE_WORKFLOW_DEMO.md`

**Limitations:**

- No agent creation or settings from the builder flow
- Execution overlay is run-detail only; the editor and published-version graph stay authoring/read-only
- `WorkflowNodeRun` has `childRunId` but no `runAttemptId`; attempt inspection stays on Run Detail. WorkflowRun Detail discovers artifacts via AGENT child Runs.
- Requires **EDITOR** or **ADMIN** role (WRITE) to publish; **OPERATOR**, **EDITOR**, or **ADMIN** (EXECUTE) to start runs and decide waits

### Not yet in console

- Full Agents product surface (Agents nav remains disabled; agents are listed only inside workflow creation)
- Global Artifact Explorer, knowledge, tools, models, settings

### Artifact retrieval (M8.5.2)

Allowlisted BFF routes (server-held `OSVA_CONSOLE_API_KEY`, no generic proxy):

- `GET /api/v1/artifacts`
- `GET /api/v1/artifacts/:artifactId` → `GET /v1/artifacts/:artifactId`
- `GET /api/v1/artifacts/:artifactId/content` → `GET /v1/artifacts/:artifactId/content`

Content is streamed with `OsvaHttpClient.download()`, which returns the upstream body without buffering. The SDK default **30s timeout applies only to waiting for response headers** and is not increased. After headers arrive, the Console applies a **60s idle timeout** on the body stream so a stalled upstream cannot hang the browser connection indefinitely.

Downloads always send `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. Filenames are sanitized (no CR/LF or path separators). Object-store URLs and API keys never leave the Console server.

Run Detail previews are user-triggered, allowlisted (`text/markdown`, `text/plain`, `application/json`, and a few other text types), rendered as escaped text or `JsonView`, and capped at 512 KiB with a streaming byte limit. HTML, SVG, XML, and other unsafe types are not previewed. Download uses the same-origin BFF content URL.

WorkflowRun Detail associates artifacts by AGENT `WorkflowNodeRun.childRunId` → `Artifact.producer.runId`. APPROVAL, WAIT, BRANCH, PARALLEL, and JOIN nodes are not treated as producers. List queries are scoped per child Run (`GET /api/v1/artifacts?runId=`) with bounded pagination (100 items, 5 pages). Partial child-run failures and truncated pages are shown explicitly. Contract-valid `ArtifactReferenceV1` values on workflow or AGENT node output may enrich the list only when metadata producer verification succeeds.
