# REST API V1 (Stage 3.7 freeze)

`/v1` is the public major REST version for OSVA Community 1.0.

## Authentication

Two **Community Edition** planes (M11):

| Plane | Routes | Credential |
| --- | --- | --- |
| **Machine** | Product `/v1/*` (except human auth routes) | `Authorization: Bearer <osva_ak_…>` |
| **Human** | `/v1/auth/*` and human-authorized product routes | HttpOnly session cookie (`osva.session_token`); mutating auth routes require trusted browser `Origin` |

- Public probes: `GET /health`, `GET /ready` only.
- Machine workspace identity is derived from the API-key `RequestPrincipal`.
- Human workspace context uses membership plus `x-osva-workspace-id` where required (must match path workspace id).
- Client-supplied workspace IDs in bodies or query strings are not authoritative for either plane.
- Invalid Bearer credentials do **not** fall back to a session cookie.

## Authorization and tenancy

| Condition | HTTP | Code |
| --- | --- | --- |
| Missing/invalid API key on `/v1` | 401 | `AUTHENTICATION_REQUIRED` |
| Missing resource or foreign workspace ID | 404 | `RESOURCE_NOT_FOUND` |
| Resource in workspace, role lacks action | 403 | `PERMISSION_DENIED` |
| JSON body above default limit | 413 | `REQUEST_TOO_LARGE` |
| Abuse rate limit exceeded | 429 | `RATE_LIMITED` |
| Rate-limit store unavailable | 503 | `SERVICE_UNAVAILABLE` |

Foreign workspace access must not return `403` (existence leak).

## Error envelope

Stable security and tenancy errors use:

```json
{
  "status": "error",
  "code": "AUTHENTICATION_REQUIRED",
  "requestId": "…"
}
```

Clients must key on HTTP status and stable `code` values, not message text.

`429 RATE_LIMITED` includes `Retry-After` (seconds) and `x-osva-request-id`. It is abuse protection, not a billing quota. Official TypeScript/Python SDKs and the CLI (via the Node SDK) do not automatically retry `429`. `503 SERVICE_UNAVAILABLE` is used when the Valkey rate-limit store is down; it is not a throttle signal.

Machine callers remain the API-key `RequestPrincipal` (`subjectId`, `workspaceId`, `role`, `authenticationMethod: API_KEY`). Human sessions use separate principal types and fixed workspace roles; public product JSON does not expose organization billing or invitation fields.

## Compatibility within `/v1`

Generally safe:

- new endpoint;
- new optional request field;
- new optional response metadata clients can ignore;
- additive enum values (still risky for exhaustive clients);
- internal implementation changes preserving semantics.

Breaking:

- removing or renaming fields/endpoints;
- changing field types or meaning;
- changing identity or workspace semantics;
- changing pagination ordering contracts;
- making optional request fields required;
- incompatible error-code changes.

Breaking `/v1` changes require `/v2` or a documented major transition.

## Machine-enforced baseline

Route existence: `apps/web/src/v1-route-inventory.ts` (+ HTTP probe parity test).

Security baseline: `apps/web/src/v1-rest-compatibility-baseline.ts` freezes method, path, authentication requirement, minimum authorization action, and resource family. CI fails if a stable route disappears or its security classification changes without updating the baseline.

## SDK expectations

- TypeScript: `new OsvaClient({ baseUrl, apiKey })`.
- Python: `OSVAClient(base_url=…, api_key=…)`.
- CLI: `OSVA_BASE_URL`, `OSVA_API_KEY` (no `OSVA_WORKSPACE_ID` security context).

## Versioning and deprecation

Follow `docs/architecture/COMPATIBILITY_AND_MIGRATION.md` for contract versioning and deprecation windows.

## Evaluation suites and batch runs (M13.7 / M13.7.5)

Canonical JSON shapes: `@osva-ai/contracts` Zod schemas in `packages/contracts/src/schemas/evaluation-suite.ts`, `evaluation-quality-gate.ts`, and `evaluation.ts`. HTTP mapping: `apps/web/src/evaluation-http.ts`.

Evaluation coordinates **ordinary child Runs** per case; there is no separate evaluation worker. Batch launch, scoring, usage aggregation, and quality gates are described in [`../architecture/flows/evaluation-run.md`](../architecture/flows/evaluation-run.md).

### Authorization (machine API key)

| Route pattern | Method | Minimum action |
| --- | --- | --- |
| `/v1/evaluation-suites` | GET | READ |
| `/v1/evaluation-suites` | POST | WRITE |
| `/v1/evaluation-suites/:evaluationSuiteId` | GET | READ |
| `/v1/evaluation-suites/:evaluationSuiteId/versions` | GET | READ |
| `/v1/evaluation-suites/:evaluationSuiteId/versions` | POST | WRITE |
| `/v1/evaluation-suites/:evaluationSuiteId/versions/:evaluationSuiteVersionId` | GET | READ |
| `/v1/evaluation-runs` | GET | READ |
| `/v1/evaluation-runs` | POST | **EXECUTE** |
| `/v1/evaluation-runs/:evaluationRunId` | GET | READ |
| `/v1/evaluation-runs/:evaluationRunId/case-results` | GET | READ |

Foreign workspace IDs return **404** `RESOURCE_NOT_FOUND` (including gated runs and assessments). In-workspace RBAC failures return **403** `PERMISSION_DENIED`.

Schema validation failures on JSON bodies or list query parameters return **400** with `{ "status": "invalid_request" }` (not the structured error envelope above).

### Evaluation suites

**`GET /v1/evaluation-suites`** — list suites in the workspace.

Response `200`:

```json
{
  "items": [
    {
      "id": "…",
      "workspaceId": "…",
      "key": "my-suite",
      "name": "My Suite",
      "description": "optional",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

**`POST /v1/evaluation-suites`** — create suite metadata (cases are added via version append).

Request:

```json
{
  "key": "my-suite",
  "name": "My Suite",
  "description": "optional"
}
```

Response **201**: `evaluationSuiteResource` (same fields as list item).

**`GET /v1/evaluation-suites/:evaluationSuiteId`** — response **200**: single suite resource.

### Evaluation suite versions (immutable)

**`GET /v1/evaluation-suites/:evaluationSuiteId/versions`** — response **200**:

```json
{ "items": [ /* evaluationSuiteVersionResource */ ] }
```

**`POST /v1/evaluation-suites/:evaluationSuiteId/versions`** — append a new immutable version with one or more cases.

Request:

```json
{
  "cases": [
    {
      "key": "case-a",
      "name": "optional display name",
      "input": {},
      "expected": {},
      "evaluator": {
        "type": "JSON_EXACT_MATCH",
        "expected": {}
      }
    }
  ]
}
```

- `evaluator.type` is **`JSON_EXACT_MATCH`** only (see `evaluatorConfigSchema`).
- `input`, `expected`, and evaluator `expected` are JSON values.

Response **201**:

```json
{
  "id": "…",
  "evaluationSuiteId": "…",
  "version": 1,
  "cases": [
    {
      "id": "…",
      "evaluationSuiteVersionId": "…",
      "key": "case-a",
      "name": "optional",
      "input": {},
      "expected": {},
      "evaluator": { "type": "JSON_EXACT_MATCH", "expected": {} },
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

**`GET /v1/evaluation-suites/:evaluationSuiteId/versions/:evaluationSuiteVersionId`** — response **200**: single version resource (includes embedded cases).

### Evaluation batch launch

**`POST /v1/evaluation-runs`** — start a batch evaluation against an immutable suite version and a target agent or workflow version.

Request:

```json
{
  "evaluationSuiteVersionId": "…",
  "targetType": "AGENT_VERSION",
  "targetVersionId": "…",
  "qualityGatePolicy": {
    "schemaVersion": 1,
    "rules": [
      { "metric": "PASS_RATE", "operator": "MIN", "threshold": 1 }
    ]
  }
}
```

- `targetType`: `AGENT_VERSION` | `WORKFLOW_VERSION`.
- `targetVersionId`: agent version id or workflow version id matching `targetType`.
- `qualityGatePolicy` is **optional**. When omitted, responses omit `qualityGate`.

Policy rules (at most **16**, one rule per metric, no duplicates):

| Metric | Operator | Threshold |
| --- | --- | --- |
| `PASS_RATE` | MIN | unit rate `[0, 1]` |
| `QUALITY_SCORE` | MIN | unit rate `[0, 1]` |
| `COMPLETION_COVERAGE` | MIN | unit rate `[0, 1]` |
| `ERROR_COUNT` | MAX | non-negative integer |
| `ESTIMATED_COST_USD_MICROS` | MAX | non-negative integer (USD **micros**, priced subtotal only) |
| `DURATION_MS` | MAX | non-negative integer |

Invalid policy (unknown metric, duplicate metric, threshold out of range, empty rules) → **400** `invalid_request`.

Response **201**: `evaluationRunDetailResource` (run fields + `summary` + optional `qualityGate`). See below.

### Evaluation run lifecycle

Run `status` values: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`.

**`GET /v1/evaluation-runs/:evaluationRunId`** — response **200**: `evaluationRunDetailResource`.

**`GET /v1/evaluation-runs`** — cursor-paginated list of runs (**without** `summary` or `qualityGate` on each item).

Query parameters (all optional):

| Parameter | Description |
| --- | --- |
| `limit` | Positive integer, default **50**, max **100** |
| `cursor` | Opaque cursor from prior `nextCursor` |
| `evaluationSuiteId` | Filter by suite |
| `evaluationSuiteVersionId` | Filter by suite version |
| `agentVersionId` | Filter when target is an agent version |
| `status` | Filter by run status |

Response **200**:

```json
{
  "items": [ /* evaluationRunResource */ ],
  "nextCursor": "optional"
}
```

**`GET /v1/evaluation-runs/:evaluationRunId/case-results`** — response **200**:

```json
{
  "items": [
    {
      "id": "…",
      "evaluationRunId": "…",
      "evaluationCaseId": "…",
      "runId": "…",
      "outcome": "PASS",
      "evaluatorResults": {},
      "createdAt": "2026-01-01T00:00:00.000Z",
      "completedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

Case `outcome`: `PASS` | `FAIL` | `ERROR`.

### Run detail: summary (deterministic scoring + usage)

Every **`GET /v1/evaluation-runs/:id`** and **`POST /v1/evaluation-runs`** detail includes `summary`:

| Field | Meaning |
| --- | --- |
| `totalCases` | Cases on the pinned suite version |
| `pendingCases` | Not yet reconciled |
| `runningCases` | Reserved (currently **0** in aggregation) |
| `completedCases` | Reconciled case results |
| `passedCases` / `failedCases` / `errorCases` | Outcome counts |
| `passRate` | `passedCases / totalCases` |
| `completionCoverage` | `min(completedCases, totalCases) / totalCases` |
| `validScoredCaseCount` | PASS/FAIL cases contributing to quality score |
| `qualityScore` | Mean of per-case scores (PASS=1, FAIL=0); **omitted** when no scored cases |
| `durationMs` | Wall time from first to last case completion when measurable; **omitted** when unknown |
| `inputTokens` / `outputTokens` | Sum across child RunAttempts (MODEL steps) |
| `pricedCostUsdMicros` | Sum of priced MODEL step estimates (micros) |
| `unpricedModelCalls` | MODEL steps lacking a price |
| `usageMeasured` | `false` when no measurable usage was found |

Usage and cost are **aggregates** for observability and gate rules; they are not billing invoices.

### Quality gate policy and assessment

When `qualityGatePolicy` was supplied at launch, responses include:

```json
{
  "qualityGate": {
    "policy": { "schemaVersion": 1, "rules": [] },
    "assessment": {
      "schemaVersion": 1,
      "overallVerdict": "INDETERMINATE",
      "lifecycleVerdict": "INDETERMINATE",
      "ruleResults": [],
      "assessedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

- When no policy was configured, **`qualityGate` is omitted** entirely.
- `assessment` may be omitted only when policy exists but assessment is not yet materialized; in practice non-terminal gated runs include a **preview** `assessment`.
- **`overallVerdict` is never `PASS` on preview reads** until a terminal assessment is persisted (see architecture flow).

**Verdicts:** `PASS`, `FAIL`, `INDETERMINATE`.

**Rule `reasonCode` values:** `THRESHOLD_SATISFIED`, `THRESHOLD_VIOLATED`, `MISSING_EVIDENCE`, `COST_INCONCLUSIVE_UNPRICED`, `LIFECYCLE_INCOMPLETE`, `LIFECYCLE_RUN_FAILED`, `LIFECYCLE_RUN_CANCELLED`.

**Lifecycle vs gate:** `lifecycleVerdict` reflects evaluation run status (`COMPLETED` required for PASS). `overallVerdict` combines lifecycle with threshold results. A **COMPLETED** run can still **FAIL** or be **INDETERMINATE** on metrics (for example pass rate below minimum). **`FAILED` / `CANCELLED` runs gate FAIL** regardless of case metrics.

**Missing evidence:** Rules on `QUALITY_SCORE` or `DURATION_MS` yield **INDETERMINATE** when the summary omits those fields. **`ESTIMATED_COST_USD_MICROS`** is **INDETERMINATE** when `unpricedModelCalls > 0` even if the priced subtotal is under threshold; exceeding the priced subtotal still **FAILs**.

Terminal **COMPLETED** runs persist one immutable row in `evaluation_run_gate_assessments` (migration **`0029_evaluation_quality_gate_slice`**). Subsequent GETs return the stored assessment.

### Execution lifecycle (not exposed as separate endpoints)

After **POST /v1/evaluation-runs**, the control plane enqueues one child **Run** per case. Progress is observed via run status, **`case-results`**, and **`summary`** on the evaluation run detail. There is no cancel/patch evaluation-run endpoint in V1 HTTP today.
