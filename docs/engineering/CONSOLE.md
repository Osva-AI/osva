# OSVA Console (`apps/console`)

`apps/web` is the OSVA public control-plane API. `apps/console` is the browser-based developer/operator product console.

The console never connects to PostgreSQL directly and never exposes OSVA API keys or session tokens to the browser. The browser talks only to the console origin; the console BFF forwards the human `osva.session_token` HttpOnly cookie to `apps/web` for interactive `/v1` calls. Machine automation continues to use Bearer API keys directly against `apps/web`, not through the Console.

## Required environment

| Variable | Purpose |
| --- | --- |
| `OSVA_BASE_URL` | Control plane base URL (default `http://127.0.0.1:3000`) |
| `OSVA_CONSOLE_LEGACY_API_KEY_MODE` | Deprecated opt-in API-key BFF mode (`true` + `OSVA_CONSOLE_API_KEY`) |
| `OSVA_CONSOLE_API_KEY` | Only when legacy API-key mode is enabled |
| `OSVA_CONSOLE_HOST` | Console bind host (default `127.0.0.1`). Must be loopback (`127.0.0.0/8`, `::1`, or `localhost`). |
| `OSVA_CONSOLE_PORT` | Console BFF bind port (default `4174`). Vite proxies `/api` here in dev. |
| `OSVA_CONSOLE_VITE_PORT` | Vite dev server port (default `5173`, `strictPort: true`) |
| `OSVA_CONSOLE_ALLOWED_ORIGINS` | Optional comma-separated http(s) origins for browser mutations through an operator-controlled proxy. Not CORS. Not authentication. No wildcards. |
| `OSVA_CONSOLE_ALLOW_PUBLIC_BIND` | **Deprecated.** Does not enable public binding, authentication, or access control. Non-loopback binds are always rejected. |

`OSVA_API_BASE_URL` is accepted as an alias for `OSVA_BASE_URL`.

## Run locally

| Stack | `OSVA_BASE_URL` | Browser (dev `pnpm dev:console`) | Browser (`build` + `start`) |
| --- | --- | --- | --- |
| Contributor host (`pnpm dev:web`) | `http://127.0.0.1:3000` | `http://127.0.0.1:5173` (Vite) | `http://127.0.0.1:4174` |
| Self-hosted Compose (default publish port) | `http://127.0.0.1:8080` | `http://127.0.0.1:5173` | `http://127.0.0.1:4174` |

**Prerequisites:** running control plane (`GET /ready` succeeds), `OSVA_AUTH_SECRET` configured on `apps/web`, and a human user bootstrapped via `pnpm identity:bootstrap` / Console `/setup`. API keys remain for CLI/SDK only. Full journeys: [`LOCAL_DEVELOPMENT.md`](LOCAL_DEVELOPMENT.md).

1. Start infrastructure and the control plane (`apps/web` or Compose `web`) with a valid API key.
2. Build or run the console:

```bash
pnpm --filter @osva/console build
pnpm --filter @osva/console start
```

Development (Vite + console BFF):

From the **repository root** (runs `tsc` for the server, then `apps/console/scripts/dev.mjs`):

```bash
pnpm dev:console
```

Open the Vite dev URL (default `http://127.0.0.1:5173`, or `http://localhost:5173` if loopback binding differs on Windows). API calls are proxied to the BFF (default `http://127.0.0.1:4174`).

If **5173** or **4174** are already in use, set **`OSVA_CONSOLE_VITE_PORT`** and **`OSVA_CONSOLE_PORT`** to free loopback ports before `pnpm dev:console`. Do **not** run `node apps/console/scripts/dev.mjs` directly unless `apps/console/dist/server/main.js` already exists from `pnpm --filter @osva/console exec tsc -p tsconfig.server.json`.

**Isolated Compose example** (custom publish port / project): point **`OSVA_BASE_URL`** at the published web URL (for example `http://127.0.0.1:8083` for project `osva-m103c`). Verification notes: [`M10_3_SETUP_VERIFICATION.md`](M10_3_SETUP_VERIFICATION.md).

## Security model

Community Console (M11 Slice 3+) is a **human-session operator application** for workspace-scoped control-plane work. Users sign in through the Console BFF; the browser never receives API keys or session tokens in JSON. UI permission hiding is not authorization—the API remains authoritative. Console is not packaged in Compose or Helm by default. Email invitations, SSO, and SCIM remain deferred.

**Default bind is loopback** (`127.0.0.1`). `OSVA_CONSOLE_HOST` may be `127.0.0.0/8`, `::1`, or `localhost`. Wildcard and non-loopback binds (`0.0.0.0`, `::`, `*`, LAN/public addresses) are rejected. `OSVA_CONSOLE_ALLOW_PUBLIC_BIND` is deprecated and **does not provide access control**.

Remote operators must use a secure tunnel (for example SSH) or an authenticating reverse proxy whose isolated network path reaches only the loopback listener. Proxy authentication, TLS, and network isolation are **operator responsibilities**. OSVA does not treat `X-Forwarded-Host`, `X-Forwarded-Proto`, or `X-Remote-User` as identities. Proxy login is not Community RBAC and is not a Team/Enterprise member account.

State-changing BFF methods require a loopback `Host` and a same-origin, loopback, or explicitly listed `OSVA_CONSOLE_ALLOWED_ORIGINS` browser `Origin`. Cross-site `Sec-Fetch-Site` mutations are rejected before any upstream `/v1` call. Missing `Origin` is allowed for legitimate non-browser operator clients. This is request validation, not permissive CORS.

- Human sessions use HttpOnly cookies on the Console origin; the BFF forwards `osva.session_token` to `apps/web` and strips upstream `Domain` from `Set-Cookie`.
- Browser `Authorization` headers are rejected by the BFF.
- Selected workspace is stored in `sessionStorage` and sent as `x-osva-workspace-id`; possession of the ID is not authorization.
- Legacy `OSVA_CONSOLE_LEGACY_API_KEY_MODE` is deprecated and disabled by default.
- Console API routes are an explicit allowlist (no generic HTTP proxy).
- JSON BFF request bodies are capped at the same 1 MiB default as control-plane `/v1` (`OSVA_DEFAULT_JSON_BODY_MAX_BYTES`). Oversized bodies return 413; invalid JSON returns 400; rejected payloads are not forwarded upstream. Rejected Host, Origin, cross-site mutation, and oversized-body requests emit one bounded security event each. Events do not include raw Host/Origin strings or `OSVA_CONSOLE_API_KEY`.
- Control-plane `429 RATE_LIMITED` is surfaced as a wait-and-retry operator error; the Console does not retry in a loop.
- Workflow builder drafts may be stored in **workspace-scoped `sessionStorage`** for authoring recovery only. Drafts never contain API keys or other secrets.

## Supported surfaces

### Agents (M8.6)

**Routes:** `/agents`, `/agents/new`, `/agents/:agentId`, `/agents/:agentId/versions/new`, `/agents/:agentId/versions/:agentVersionId`, `/onboarding`.

- Agent Registry list of persisted workspace Agents
- Agent Detail with immutable AgentVersion table (id, version number, runtime type, created timestamp)
- Register Agent (`POST /api/v1/agents` → `POST /v1/agents`) — **EDITOR** or **ADMIN** (WRITE)
- Create AgentVersion from a hybrid guided form + JSON editor that share one Agent Manifest v1 document (`POST /api/v1/agents/:agentId/versions`) — previous versions are never rewritten. TRUSTED_TYPESCRIPT placeholder integrity is rejected before submit
- Individual **Run Agent** from a selected AgentVersion (`POST /api/v1/runs` → `POST /v1/runs`) — **OPERATOR**, **EDITOR**, or **ADMIN** (EXECUTE)
- Version selection is explicit (URL + version control). The Console never silently substitutes another version
- Input contract comes from `manifest.input.schema`. JSON syntax is checked in the browser; valid JSON is not presented as executable success
- Successful create navigates to the persisted Run ID. HTTP 201 / `QUEUED` is not a terminal SUCCEEDED status
- Run observation reuses Run Detail (RunAttempts, steps, usage, artifacts). Cancellation is not offered (no public cancel API). Retry scheduling is not implemented
- First-agent onboarding (`/onboarding`) links each step to a real page. Runtime readiness uses three states: **Verified ready** only when an existing API proves it, **Requires setup** when configuration is known missing, **Not verified** otherwise. Console API success is not worker health. A digest-pinned container image in a manifest is not evidence the image exists
- Deterministic example: trusted TypeScript echo-input agent (`adapters/runtime-typescript/test/fixtures/echo-input-agent.ts`). Copy it under `OSVA_TRUSTED_RUNTIME_ROOT`, compute `sha256:<hex>`, then register through the Console. No paid model provider is required. Do not use the test `echo-agent.ts` fixture for Console first-run inspection — it echoes process environment values
- Workflow Builder handoff: **Use in Workflow Builder** opens `/workflows/new?agentId=&agentVersionId=` with selection guidance. The builder does not auto-bind; publishing a workflow never mutates the AgentVersion. Query parameters carry ids only, never secrets

### Runs (read + individual launch)

- Runs list with filters and cursor pagination
- Individual Run launch from an AgentVersion (see Agents)
- Run detail, attempts, steps, usage, and a compact execution-diagnostics panel (lease/recovery state from additive public `execution` fields). Lease expiry is persisted PostgreSQL state; the Console does not treat process or browser clocks as recovery authority. Raw execution owner is not shown.
- Artifact metadata, on-demand safe text/JSON preview (512 KiB cap), and streamed original-byte download via the Console BFF
- Polling while runs/attempts are active
- Run Detail distinguishes an individual Run from a WorkflowRun, and RunAttempts from WorkflowNodeRuns

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

- The builder does not create Agents; register them on the Agents surface first
- Execution overlay is run-detail only; the editor and published-version graph stay authoring/read-only
- `WorkflowNodeRun` has `childRunId` but no `runAttemptId`; attempt inspection stays on Run Detail. WorkflowRun Detail discovers artifacts via AGENT child Runs.
- Requires **EDITOR** or **ADMIN** role (WRITE) to publish; **OPERATOR**, **EDITOR**, or **ADMIN** (EXECUTE) to start runs and decide waits

### Common registration and execution failures

| Symptom | Likely cause |
| --- | --- |
| 400 on Agent or AgentVersion create | Extra HTTP fields (including `workspaceId`), invalid manifest, placeholder integrity, or malformed JSON |
| 403 on register / version / run | VIEWER cannot WRITE or EXECUTE. Use EDITOR/ADMIN to register, OPERATOR+ to launch |
| 404 on Agent, version, or Run | Resource is not in the authenticated workspace |
| Run stays QUEUED | Worker, Valkey, or queue is not running. Console cannot verify worker health |
| RunAttempt FAILED `UNSUPPORTED_RUNTIME` | Worker has no adapter for the manifest runtime type (common for `BUILTIN_PACKAGE` in production) |
| Trusted TypeScript integrity/entrypoint errors | File missing under `OSVA_TRUSTED_RUNTIME_ROOT`, or `runtime.integrity` is not sha256 of those bytes |
| Syntax-valid JSON then FAILED attempt | Input did not match the agent's runtime expectations. Inspect persisted attempt error |

### Not yet in console

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
