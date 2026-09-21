# Stage 3.7 — API Security and Stability (Pass 2)

Pass 2 enforces authenticated `/v1` control-plane access and workspace-scoped resource resolution.

## Invariants

- All `/v1/*` control-plane routes require `Authorization: Bearer <osva_ak_…>` (except documented public probes).
- Tenancy is taken from `RequestPrincipal.workspaceId`, not from client-supplied `workspaceId` on mutating requests.
- Foreign-workspace IDs map to **404** (`*NotFoundError`); in-workspace RBAC failures map to **403** (`PermissionDeniedError`).

## Domain

- `ControlPlaneScope` + `requireControlPlaneAuthorization` in `packages/domain/src/control-plane.ts`.
- Control-plane application `execute(scope, …)` methods authorize and use `find*ByWorkspaceAndId` / `list*ByWorkspaceId`.
- `CONTROL_PLANE_RESOURCE_KINDS` stabilizes HTTP + domain resource kind strings.

## Web

- `requireControlPlaneScope()` in each `*-http.ts` dispatch path.
- `authorizeControlPlaneRead|Write|Execute|Admin` at the HTTP boundary.
- `WebSecurityServices` required in `createWebApplication` (tests use `MemoryApiKeyRepository` + `seedTestApiKey`).

## Route inventory

| Module | Method | Path |
|--------|--------|------|
| auth-http | GET | /v1/auth/context |
| agent-http | GET | /v1/agents |
| agent-http | POST | /v1/agents |
| agent-http | GET | /v1/agents/:agentId |
| agent-http | PATCH | /v1/agents/:agentId |
| agent-http | GET | /v1/agents/:agentId/versions |
| agent-http | POST | /v1/agents/:agentId/versions |
| agent-http | GET | /v1/agents/:agentId/versions/:agentVersionId |
| model-profile-http | GET | /v1/model-profiles |
| model-profile-http | POST | /v1/model-profiles |
| model-profile-http | GET | /v1/model-profiles/:modelProfileId |
| model-profile-http | PATCH | /v1/model-profiles/:modelProfileId |
| model-profile-http | GET | /v1/model-profiles/:modelProfileId/versions |
| model-profile-http | POST | /v1/model-profiles/:modelProfileId/versions |
| model-profile-http | GET | /v1/model-profiles/:modelProfileId/versions/:modelProfileVersionId |
| connector-http | GET | /v1/connectors |
| connector-http | POST | /v1/connectors |
| connector-http | GET | /v1/connectors/:connectorId |
| connector-http | PATCH | /v1/connectors/:connectorId |
| connector-http | GET | /v1/connectors/:connectorId/versions |
| connector-http | POST | /v1/connectors/:connectorId/versions |
| connector-http | GET | /v1/connectors/:connectorId/versions/:connectorVersionId |
| connector-http | POST | /v1/connectors/:connectorId/versions/:connectorVersionId/discover |
| connector-http | POST | /v1/connectors/import-mcp-tools |
| memory-http | GET | /v1/memory/namespaces |
| memory-http | POST | /v1/memory/namespaces |
| memory-http | GET | /v1/memory/namespaces/:namespaceId |
| memory-http | GET | /v1/memory/namespaces/:namespaceId/records |
| artifact-http | GET | /v1/artifacts |
| artifact-http | POST | /v1/artifacts |
| artifact-http | GET | /v1/artifacts/:artifactId |
| artifact-http | GET | /v1/artifacts/:artifactId/content |
| knowledge-http | GET | /v1/knowledge-sources |
| knowledge-http | POST | /v1/knowledge-sources |
| knowledge-http | GET | /v1/knowledge-sources/:knowledgeSourceId |
| knowledge-http | GET | /v1/knowledge-sources/:knowledgeSourceId/indexes |
| knowledge-http | POST | /v1/knowledge-sources/:knowledgeSourceId/indexes |
| knowledge-http | GET | /v1/knowledge-indexes/:knowledgeIndexId |
| knowledge-http | POST | /v1/knowledge-indexes/:knowledgeIndexId/retry |
| knowledge-http | POST | /v1/knowledge/retrieve |
| evaluation-http | GET | /v1/evaluation-suites |
| evaluation-http | POST | /v1/evaluation-suites |
| evaluation-http | GET | /v1/evaluation-suites/:evaluationSuiteId |
| evaluation-http | GET | /v1/evaluation-suites/:evaluationSuiteId/versions |
| evaluation-http | POST | /v1/evaluation-suites/:evaluationSuiteId/versions |
| evaluation-http | GET | /v1/evaluation-suites/:evaluationSuiteId/versions/:evaluationSuiteVersionId |
| evaluation-http | POST | /v1/evaluation-runs |
| evaluation-http | GET | /v1/evaluation-runs/:evaluationRunId |
| evaluation-http | GET | /v1/evaluation-runs/:evaluationRunId/case-results |
| tool-http | GET | /v1/tools |
| tool-http | POST | /v1/tools |
| tool-http | GET | /v1/tools/:toolId |
| tool-http | PATCH | /v1/tools/:toolId |
| tool-http | GET | /v1/tools/:toolId/versions |
| tool-http | POST | /v1/tools/:toolId/versions |
| tool-http | GET | /v1/tools/:toolId/versions/:toolVersionId |
| run-observability-http | GET | /v1/runs/:runId/attempts/:runAttemptId/steps |
| run-observability-http | GET | /v1/runs/:runId/attempts/:runAttemptId/steps/:runStepId |
| run-observability-http | GET | /v1/runs/:runId/attempts/:runAttemptId/usage |
| run-observability-http | GET | /v1/runs/:runId/attempts/:runAttemptId/evaluations |
| run-observability-http | POST | /v1/runs/:runId/attempts/:runAttemptId/evaluations |
| run-observability-http | GET | /v1/runs/:runId/attempts/:runAttemptId/evaluations/:evaluationId |
| run-http | GET | /v1/runs |
| run-http | POST | /v1/runs |
| run-http | GET | /v1/runs/:runId |
| run-http | GET | /v1/runs/:runId/attempts |
| run-http | GET | /v1/runs/:runId/attempts/:runAttemptId |
| schedule-http | GET | /v1/schedules |
| schedule-http | POST | /v1/schedules |
| schedule-http | GET | /v1/schedules/:scheduleId |
| schedule-http | PATCH | /v1/schedules/:scheduleId |
| schedule-http | GET | /v1/schedules/:scheduleId/occurrences |
| workflow-http | GET | /v1/workflows |
| workflow-http | POST | /v1/workflows |
| workflow-http | GET | /v1/workflows/:workflowId |
| workflow-http | GET | /v1/workflows/:workflowId/versions |
| workflow-http | POST | /v1/workflows/:workflowId/versions |
| workflow-http | GET | /v1/workflows/:workflowId/versions/:workflowVersionId |
| workflow-http | POST | /v1/workflow-runs |
| workflow-http | GET | /v1/workflow-runs/:workflowRunId |
| workflow-http | GET | /v1/approval-requests/:approvalRequestId |
| workflow-http | POST | /v1/approval-requests/:approvalRequestId/decision |
| workflow-event-http | POST | /v1/workflow-events |
| office-http | GET | /v1/office/workers |
| office-http | POST | /v1/office/workers |
| office-http | GET | /v1/office/workers/:officeWorkerId |
| office-http | PATCH | /v1/office/workers/:officeWorkerId |
| office-http | GET | /v1/office/roles |
| office-http | POST | /v1/office/roles |
| office-http | GET | /v1/office/roles/:roleId |
| office-http | PATCH | /v1/office/roles/:roleId |
| office-http | GET | /v1/office/teams |
| office-http | POST | /v1/office/teams |
| office-http | GET | /v1/office/teams/:teamId |
| office-http | PATCH | /v1/office/teams/:teamId |
| office-http | GET | /v1/office/teams/:teamId/memberships |
| office-http | POST | /v1/office/teams/:teamId/memberships |
| office-http | GET | /v1/office/goals |
| office-http | POST | /v1/office/goals |
| office-http | GET | /v1/office/goals/:goalId |
| office-http | PATCH | /v1/office/goals/:goalId |
| office-http | GET | /v1/office/assignments |
| office-http | POST | /v1/office/assignments |
| office-http | GET | /v1/office/assignments/:assignmentId |
| office-http | PATCH | /v1/office/assignments/:assignmentId |
| office-http | POST | /v1/office/assignments/:assignmentId/launch |
| office-http | POST | /v1/office/assignments/:assignmentId/cancel |

**107** `/v1` control-plane routes (one row per HTTP method + path pattern in the table above).

Canonical machine-readable copy: `apps/web/src/v1-route-inventory.ts` (`V1_ROUTE_INVENTORY`). The route set (method + normalized path) is the Pass 2 security invariant; the headline count is informational only.

Route coverage guard: `apps/web/test/v1-route-inventory.test.ts` independently derives implemented routes by (1) parsing each `*-http.ts` handler for probe paths from real path-matching code (`scripts/lib/v1-http-route-discovery.mjs`, excluding `V1_HTTP_ROUTES` exports), (2) issuing read-only HTTP probes against a test server to learn which `METHOD + path` pairs are actually dispatched, then (3) comparing structural keys to `V1_ROUTE_INVENTORY`. Adding a handler route without inventory (or inventory without implementation) fails the test. Duplicate method+path rows and handler modules with empty `V1_HTTP_ROUTES` are also rejected. `scripts/gen-v1-http-routes.mjs` remains a developer convenience to sync `V1_HTTP_ROUTES` arrays from inventory; CI does not rewrite sources.

Pass 2 acceptance hardening adds `apps/web/test/rest-workspace-security-matrix.test.ts` (two workspaces, representative cross-tenant denial per resource family) and `apps/web/test/architecture.test.ts` guard blocking `apps/web` from importing `runtimeControlPlaneScope` / `controlPlaneWorkspaceId`.

`POST /v1/workflow-events` uses **EXECUTE** (execution-driving ingest, not definition WRITE).

## Authentication and tenancy flow

```text
HTTP request
  → request ID (ALS + OSVA-Request-Id)
  → Bearer API key authentication (http-security)
  → RequestPrincipal in security ALS
  → /v1 gate: missing principal → 401 AUTHENTICATION_REQUIRED
  → handler: requireControlPlaneScope()
  → domain execute(scope, …)
  → requireControlPlaneAuthorization(action, resource)
  → repository find/list scoped by controlPlaneWorkspaceId(scope)
  → PostgreSQL (workspace predicates in query)
```

Public probes: `GET /health`, `GET /ready` only. All `/v1/*` routes require authentication.

Production web (`apps/web/src/process.ts`) always wires `AuthenticateApiKey` + `PostgresApiKeyRepository`; `CreateWebApplicationOptions.security` is required (no fail-open composition).

## Error semantics (REST)

| Condition | HTTP | Code |
|-----------|------|------|
| Missing/invalid API key on `/v1` | 401 | `AUTHENTICATION_REQUIRED` |
| Resource missing in workspace / foreign workspace ID | 404 | `RESOURCE_NOT_FOUND` |
| Resource in workspace, role lacks action | 403 | `PERMISSION_DENIED` |

Foreign workspace access must not return 403 (existence leak). Domain `*NotFoundError` types map to `RESOURCE_NOT_FOUND` in `sendHttpError`.

## Resource security inventory (Pass 2)

All rows are **TENANT_OWNED** unless noted. **List/get/mutate scoping** uses `principal.workspaceId` via `ControlPlaneScope`. **Nested** children resolve through workspace-scoped parent lookup (run → attempts/steps/usage/evaluations; workflow → versions/runs/nodes/approvals; connector → versions/discover; schedule → occurrences; evaluation suite → versions/runs/results; team → memberships; knowledge source → indexes).

| Resource family | List | Get | Mutations | Action(s) | Caller `workspaceId` (Pass 3 cleanup) |
|-----------------|------|-----|-----------|-----------|----------------------------------------|
| Auth context | — | GET `/v1/auth/context` | — | READ (implicit) | none |
| Agents / versions | scoped | `findAgentByWorkspaceAndId` + version under agent | create/patch/version: principal WS | READ / WRITE | create body (ignored) |
| Model profiles / versions | scoped | workspace + id | WRITE | READ / WRITE | create body (ignored) |
| Tools / versions | scoped | workspace + id | WRITE | READ / WRITE | create body (ignored) |
| Connectors / versions / discover / import-tools | scoped | workspace + id | **ADMIN** (config/mutation); discover EXECUTE | READ / ADMIN / EXECUTE | create/patch body (ignored) |
| Memory namespaces / records | scoped | workspace + id | WRITE namespaces; READ records | READ / WRITE | create body (ignored) |
| Artifacts / content | scoped | workspace + id | WRITE upload; READ content | READ / WRITE | multipart/body fields (ignored for tenancy) |
| Knowledge sources / indexes / retry | scoped (lists force principal WS) | workspace + id; indexes via source in WS | WRITE | READ / WRITE | query/body `workspaceId` on lists (non-authoritative) |
| Evaluation suites / versions / runs / case-results | scoped | workspace + nested ids | WRITE suites; EXECUTE runs | READ / WRITE / EXECUTE | create body (ignored) |
| Runs / attempts | **`listRuns({ workspaceId })` from principal** | run + attempt under run in WS | POST run EXECUTE | READ / EXECUTE | create run body (ignored) |
| Run observability (steps, usage, evaluations) | — | child of run in WS | POST evaluation EXECUTE | READ / EXECUTE | — |
| Schedules / occurrences | scoped | workspace + id | WRITE | READ / WRITE | list/create query/body (ignored where principal used) |
| Workflows / versions / workflow runs | scoped | workspace + id | WRITE defs; EXECUTE runs | READ / WRITE / EXECUTE | workflow list query; approval query/body (lookup uses principal) |
| Approval requests / decision | — | scoped by principal | decision EXECUTE | READ / EXECUTE | query/body `workspaceId` (non-authoritative) |
| Workflow events | — | — | POST ingest **EXECUTE** | EXECUTE | body uses principal in handler |
| Office workers, roles, teams, goals, assignments | scoped via domain | workspace + id | WRITE; launch/cancel EXECUTE | READ / WRITE / EXECUTE | **list GET still requires `?workspaceId=` for schema validation; domain lists use principal only** |

Office **roles, goals, assignments, and team memberships** use the same tenancy path as workers/teams: `requireControlPlaneScope()` at the HTTP boundary, then `createOfficeApplication` commands that authorize and resolve via `controlPlaneWorkspaceId(scope)` and `find*ByWorkspaceAndId` / `list*ByWorkspace` on `MemoryOfficeRepository` (see `packages/domain/src/office-application.ts`). Representative two-workspace coverage in `rest-workspace-security-matrix.test.ts` (workers, teams, `workspaceId` query override) applies to those families without per-subresource duplication.

**INTENTIONALLY_INSTALLATION_GLOBAL (public REST):** none besides `/health` and `/ready`.

Internal execution plane continues to use immutable IDs (`findById`, frozen bindings, `runtimeControlPlaneScope(workspaceId)` for worker/runtime artifact paths).

## Transitional caller `workspaceId` inputs (Pass 3 removal)

Non-authoritative fields still present in public schemas or query strings for SDK compatibility:

- Agent, tool, model profile, connector, memory, schedule, run, workflow create bodies: `workspaceId` (HTTP overwrites with `scope.principal.workspaceId` on create).
- Knowledge: `workspaceId` query on source/index list (domain now forces principal workspace).
- Workflows: `workspaceId` query on workflow collection GET (handler may still parse; list uses `ListWorkflows(scope)` only).
- Approvals: `workspaceId` query/body on get/decide (domain uses principal for lookup).
- Office: `workspaceId` query required on several list routes (domain ignores for filtering; remove query requirement in Pass 3).
- Evaluation / artifact responses still echo resource `workspaceId` (informational).

Tests: `apps/web/test/rest-workspace-isolation.test.ts` and `rest-workspace-security-matrix.test.ts` prove body/query `workspaceId=B` cannot escape workspace A and assert public 401/403/404 + request ID semantics.

## Authorization mapping (summary)

| Action | Typical routes |
|--------|----------------|
| READ | GET lists/single resources, auth context, memory records, artifact download |
| EXECUTE | POST `/v1/runs`, workflow runs, evaluation runs, run evaluations, approval decisions, assignment launch/cancel, connector discover |
| WRITE | POST/PATCH tenant definitions (agents, tools, workflows, schedules, office, knowledge, evaluations, artifacts upload) |
| ADMIN | Connector create/update/version/import-tools |

## Database

No new migration in Pass 2 (`0023` not added). Migrations `0000`–`0022` unchanged. Workspace columns on tenant tables were already present; Pass 2 enforces them in application/repository boundaries.

## Tests

- Per-handler HTTP tests use bearer auth via `http-test-helpers` / `createTestWebApplication`.
- `rest-workspace-isolation.test.ts`: narrow agents-focused isolation.
- `rest-workspace-security-matrix.test.ts`: two-workspace matrix across agents, runs, observability, workflows, schedules, connectors (+ ADMIN), tools/model profiles, artifacts, memory, knowledge, evaluations, office, auth, role denial.
- `workflow-event-workspace-isolation.test.ts`: workspace A cannot resolve workspace B EVENT waits (durable wait + node run unchanged).
- `v1-route-inventory.test.ts`: implemented-route HTTP probes ↔ `V1_ROUTE_INVENTORY` parity (see route coverage guard above).
- `architecture.test.ts`: REST must not import runtime control-plane bypass helpers.
- Domain/adapters/orchestration tests updated for `ControlPlaneScope` and workspace-scoped repository ports.
- Role matrix exercised via COMMUNITY_EDITION_ROLES in isolation test and existing auth tests.

## Deferred

- **Pass 3:** SDK/CLI/MCP API-key migration; remove caller `workspaceId`; connector egress/STDIO hardening.
- **Pass 4:** JSON body size default for generic REST (not applied in Pass 2 to avoid breaking artifact uploads); migration hash lock / `verify:ci:clean` gate.