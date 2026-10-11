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
- Run detail, attempts, steps, usage, artifact metadata
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

### Workflow creation (M8.3.1)

**Route:** `/workflows/new` (linked from the Workflows list).

**Capabilities:**

- Create a workflow registry row (`key`, `name`, optional `description`)
- Build a **Workflow Definition V3** draft using a **linear AGENT-only** editor (add, remove, reorder steps)
- Discover workspace agents and bind **immutable AgentVersion** ids on each AGENT node
- Publish the draft as a new immutable `WorkflowVersion` via the control plane

**Draft model:**

- The executable draft is a canonical `WorkflowDefinitionV3` (`nodes` + `edges`) in client state
- Canvas layout (`layoutByNodeKey`) is kept separate and is **not** sent to the API
- Node keys remain stable when steps are reordered (edges are rebuilt)

**Publish behavior:**

- Registry creation and version publication are separate API calls
- If registry creation succeeds but version publication fails, the UI retains `workflowId`, shows partial-success messaging, and allows **retry publish** without creating a duplicate workflow
- Successful publish clears the workspace draft from `sessionStorage` and navigates to the new version page

**Validation:**

- Client-side Zod shape checks and basic field validation for faster feedback
- DAG rules and agent-version binding remain **authoritative** on the control plane; upstream errors and request IDs are shown as returned

**Limitations (M8.3.1 authoring):**

- No editable graph canvas on `/workflows/new` (form/list editor only); published V3 versions have a **read-only** graph on the version page (M8.3.2-1)
- AGENT nodes in a single linear chain only (no BRANCH, PARALLEL, JOIN, APPROVAL, or WAIT authoring UI)
- No agent creation, workflow run launch, or settings from this flow
- Requires **EDITOR** or **ADMIN** role (WRITE) on the workspace API key

### Not yet in console

- Full Agents product surface (Agents nav remains disabled; agents are listed only inside workflow creation)
- Artifact preview/download, knowledge, tools, models, settings
