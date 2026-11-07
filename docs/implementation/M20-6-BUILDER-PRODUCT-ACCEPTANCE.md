# M20.6 — Builder product acceptance

## Objective

Measure whether OSVA's natural-language workflow builder produces structurally valid, intent-aligned, publishable workflows using real control-plane services and (optionally) billable model providers.

M20.6 is an **evaluation and operational-readiness** milestone. It reuses M12.3 disposable-stack patterns and M20.1–M20.5 builder capabilities without introducing new product features.

## Architecture reuse

| Layer | Reuse |
| --- | --- |
| Isolated stack | `apps/console/test/integration/m12-3-harness.ts` (PostgreSQL, Valkey, Web, Console BFF, human session) |
| Deterministic provider | `adapters/model-openai/test/fake-openai-server.ts` + `m20-6-builder-scenario-responses.ts` |
| Builder domain | `GenerateBuilderProposalFromNaturalLanguage`, refinement, publication (M20.2–M20.5) |
| Evaluation scoring | `scripts/acceptance/m20-6/lib/scoring.mjs` + `apps/console/test/integration/m20-6-eval.ts` |
| Token measurement | Optional `metadata.measuredUsage` on generation/refinement responses (M20.6) |

Publication does **not** require the execution worker; acceptance stacks may start a worker for parity with M12.3 but do not auto-run published workflows.

## Scenario catalog

Versioned manifest: `scripts/acceptance/m20-6/scenarios/manifest.json`

| ID | Intent |
| --- | --- |
| `simple` | Single NEW agent, one AGENT node |
| `sequential` | Three-stage linear pipeline |
| `parallel` | PARALLEL + JOIN topology |
| `approval` | APPROVAL gate in graph |
| `wait-event` | WAIT (EVENT) node — no external execution in acceptance |
| `conversational-refinement` | Multi-turn refine then publish |

Prompts include deterministic marker `OSVA_M20_6_SCENARIO=<id>` (not a REST contract).

## Runner modes

### Mode A — deterministic (CI-safe)

```bash
pnpm acceptance:m20-6
pnpm acceptance:m20-6:smoke
pnpm acceptance:m20-6:browser
```

- Fake OpenAI returns scenario-keyed `BuilderProposalV1` JSON.
- Proves runner, scoring, publication idempotency, authorization negatives, and evidence redaction.
- Does **not** prove live model quality.

### Mode B — live provider (operator opt-in)

```bash
set OSVA_M20_6_LIVE=1
set OPENAI_API_KEY=...
pnpm acceptance:m20-6:live -- --provider=openai
```

Requires configured workspace model profiles pointing at real providers. Never enabled in default CI. When credentials are missing, the runner reports `LIVE_PROVIDER_NOT_RUN` / `BLOCKED_PREREQUISITE` without fabricating PASS evidence.

## Cost and safety controls

Environment knobs (see `scripts/acceptance/m20-6/lib/budgets.mjs`):

- `OSVA_M20_6_MAX_BUILDER_REQUESTS`
- `OSVA_M20_6_MAX_PROVIDER_INVOCATIONS`
- `OSVA_M20_6_MAX_TOTAL_DURATION_MS`
- `OSVA_M20_6_MAX_COST_USD_MICROS` (optional; unpriced when usage unknown)

Sequential execution by default; bounded provider repair remains the builder's existing `maxProviderInvocations`.

## Evidence

Gitignored artifacts:

- `artifacts/m20-6/acceptance-results.json`
- `artifacts/m20-6/acceptance-report.md`

## M20.5 status

M20.5 (conversational refinement) is merged via PR #102 on `main`; M20.6 exercises refinement in the `conversational-refinement` scenario and safety cases (stale digest, unauthorized model profile).

## Verification

```bash
pnpm acceptance:m20-6:test
pnpm --filter @osva/domain test -- builder-generation-usage
```

Integration: `apps/console/test/integration/m20-6-builder-acceptance.integration.test.ts`

Browser (one journey): `apps/console/test/integration/m20-6-browser.integration.test.ts`
