# Product Console workflow demo

Reproducible demonstration of OSVA using the **Product Console** (`apps/console`) against a real stack. This is not a separate demo application. The M7 canonical example (`examples/canonical-dependency-adoption`) is the preferred fixture.

Do not present mocked or fabricated execution states as live runs.

## What this shows

OSVA is a control plane for agents and workflows. Operators compose immutable AgentVersions into a Workflow Definition V3, publish a WorkflowVersion, start a WorkflowRun, and observe persisted execution: child Runs for AGENT nodes, human approval, durable waits, and results.

## Prerequisites

- PostgreSQL (pgvector) and Valkey via `pnpm infra:up` (or equivalent)
- Control plane `apps/web` on `OSVA_BASE_URL` (local default `http://127.0.0.1:3000`)
- `apps/worker` and `apps/workflow-orchestrator`
- Workspace API key with **ADMIN** or **EDITOR** (publish) and **OPERATOR+** (execute)
- Console: `OSVA_CONSOLE_API_KEY` set server-side only — never paste the key into the browser or this document
- Canonical example built and bootstrapped (`pnpm run canonical:setup`)

Optional for live model calls: provider credentials on the worker. The M6 deterministic suite can seed the same architecture without OpenAI credits; a product demo that launches Research/Analysis/Report needs a working model binding.

## Setup

```bash
pnpm infra:up
pnpm --filter @osva/web dev
pnpm --filter @osva/worker dev
pnpm --filter @osva/workflow-orchestrator dev
pnpm --filter @osva/example-canonical-dependency-adoption build
pnpm run canonical:setup
OSVA_CONSOLE_API_KEY=<workspace-api-key> pnpm dev:console
```

Open the Vite URL printed by `dev:console` (default `http://localhost:5173`). API calls proxy to the console BFF.

If only a production console build is running, rebuild first so M8.5 source is served:

```bash
pnpm --filter @osva/console build
OSVA_CONSOLE_API_KEY=<workspace-api-key> pnpm --filter @osva/console start
```

Confirm the shell shows **Role ADMIN** (or EDITOR/OPERATOR as appropriate). Do not commit `.env` files or keys.

## Presentation flow

Use workflow key `canonical-dependency-adoption` (name: Canonical Dependency Adoption).

```text
research → analysis → adoption-approval → delivery-wait → report
```

| Step | Action | Expected |
| --- | --- | --- |
| 1. What OSVA does | Open Overview, then **Workflows** | Workspace-scoped registry. Agents are composed as workflow nodes; only AGENT nodes create Runs. |
| 2. Connect agents | **Create workflow** (builder) or open the published canonical version | AGENT nodes bind immutable AgentVersions (Research, Analysis, Report). APPROVAL and WAIT do not create Runs. |
| 3. Publish | Builder: valid key/name/graph → **Review and publish** | New immutable WorkflowVersion. Drafts are not executable. |
| 4. Launch | Published version → **Run workflow** | First-agent input contract is visible. JSON syntax is not claimed as schema acceptance. Confirm, then Console navigates to the WorkflowRun. |
| 5. Observe agent runs | WorkflowRun **Execution** graph | Persisted node statuses. AGENT cards link to child Runs. RunAttempts appear only on child Run detail. |
| 6. Human approval | When `adoption-approval` is WAITING | Banner: workflow is suspended; workers are not kept alive. Approve/Reject use the persisted ApprovalRequest id. VIEWER keys cannot mutate. |
| 7. Event wait | When `delivery-wait` is WAITING | Emit the configured source/event/correlation. Resume appears only after the control plane confirms it. Re-ingest does not create a second wait node. |
| 8. Results | Terminal WorkflowRun + Report child Run | Workflow output is on the WorkflowRun. Related artifacts lists the Report Markdown file. Preview shows escaped text. Download saves the original attachment. |

### Canonical launch input

Use the contract shown on the published version page (do not send `{}` if `schemaVersion` and `request` are required). A typical shape:

```json
{
  "schemaVersion": "1",
  "request": {
    "requestId": "demo-001",
    "packageName": "zod",
    "useCase": "Runtime validation for public API request bodies",
    "constraints": ["Permissive license", "Actively maintained"]
  }
}
```

`pnpm run canonical:run` / `canonical:approve` / `canonical:emit-delivery-event` remain valid operator fallbacks if you need to drive the same WorkflowRun from the CLI.

## Artifact inspection (M8.5)

After the Report AGENT succeeds:

1. Open the WorkflowRun Detail page.
2. Find the **report** node in Execution. It links to the producing child Run.
3. In **Related artifacts**, confirm the Markdown review file (name is typically `dependency-adoption-review-<package>-<requestId>.md`, not a generic `report.md`).
4. Click **Preview** only when you want content. Markdown is shown as escaped text inside `<pre>` — it is not rendered as HTML. Preview is refused for HTML, SVG, XML, JavaScript, PDF, and other non-allowlisted types, and for files larger than **512 KiB**.
5. Click **Download** to save the original bytes through the same-origin Console BFF (`/api/v1/artifacts/:artifactId/content`). The response is `Content-Disposition: attachment` with `X-Content-Type-Options: nosniff`.
6. Open the producing child Run. The same artifact appears with digest, producer Run/RunAttempt, and optional metadata. Attempts stay on this page.
7. Artifact bytes remain readable after the worker/container that produced them has exited. Persistence is OSVA artifact storage, not the runtime process.

Do not paste API keys into the browser. The Console server holds `OSVA_CONSOLE_API_KEY`.

## Optional topology fixtures

These are **demo fixtures**, not product features. They exist in workspaces used for M8.4 acceptance and can be recreated as small V3 graphs (no model agents required):

| Fixture key | Purpose |
| --- | --- |
| `m842-branch-20261012` | BRANCH `selectedTargetKey`, SKIPPED inactive path, JOIN success |
| `m842-parallel-20261012` | Independent PARALLEL children; JOIN stays **NO RECORD** if a sibling fails |
| `m842-timer-20261012` | TIMER wait then APPROVAL; no countdown |
| `m842-event-20261012` / `m843-event-20261012` | EVENT wait emit + correlation |

Do not mark unselected BRANCH paths as FAILED. Missing WorkflowNodeRun records must stay **NO RECORD**.

## Cleanup

- Leave published WorkflowVersions in place (immutable).
- Cancel or ignore leftover WAITING demo runs if you do not want them to remain open.
- Do not delete the canonical WorkflowVersion used by `canonical-state.json`.
- Stop Console / web / worker / orchestrator processes. `pnpm infra:down` tears down local Docker infra.

## Known limitations

- Console is bound to one workspace API key. VIEWER vs OPERATOR must be demonstrated with a second key or accepted from unit coverage.
- WorkflowRun Detail lists artifacts produced by AGENT child Runs. It does not provide a workspace-wide Artifact Explorer.
- Automatic RunAttempt retry is not a product feature. Multiple WorkflowNodeRun rows for one key are historical node records, not retries.
- The M7 `canonical:demo` UI (port 4173) is a separate read-model example. Use this Console demo for product evaluation.
