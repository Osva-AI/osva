# M13 Closeout Summary — No-code Product Console

**Platform baseline:** Community **`1.1.x`** line (post M12 capability foundation).

**Milestone:** M13 — declarative agents, Console studios (Agent, Knowledge, Workflow, Testing), evaluation scoring and quality gates through **M13.7.5**.

Evidence checklist: [`M13_ACCEPTANCE_SUMMARY.md`](M13_ACCEPTANCE_SUMMARY.md).

## Delivered product capabilities

| Area | What shipped |
| --- | --- |
| **Declarative agents (M13.1–M13.2)** | `DECLARATIVE` Agent Manifest v1, append validation, in-process `DeclarativeRuntimeAdapter` with budgeted model/tool loops via gateways |
| **Agent Studio (M13.3)** | Console no-code declarative agent authoring and validation UX |
| **Workspace UX (M13.4)** | Overview and onboarding shell |
| **Knowledge Studio (M13.5)** | Knowledge and memory studio shell |
| **Workflow Studio (M13.6)** | No-code workflow builder with human-session Console |
| **Testing Studio (M13.7)** | Landing, agent playground, suite builder, batch evaluation runs, deterministic summaries, usage/cost aggregates, optional quality gates |
| **Engineering (M13.5.1)** | Branch-impact verification wiring for M13 Console browser tests |

## Architecture and compatibility

- **Control plane vs execution:** Unchanged — Runs, RunAttempts, BullMQ worker, PostgreSQL lifecycle authority.
- **Declarative runtime:** Selected by immutable AgentVersion manifest; not chosen by workflow nodes ([ADR-009](../adr/ADR-009-declarative-agent-runtime.md)).
- **Evaluation:** Coordinator model preserved — one child Run per case, JSON exact match evaluator, optional batch quality gate ([evaluation-run flow](../architecture/flows/evaluation-run.md)).
- **Additive REST:** Evaluation suite/version/run routes and optional `qualityGatePolicy` / `summary` fields documented in [`REST_API_V1.md`](../contracts/REST_API_V1.md).
- **Human Console:** M13 studios assume M11 human BFF sessions (M12.3 harness reused in browser tests); machine API keys remain for automation.

## Important decisions

- **ADR-009** — declarative configuration is manifest JSON only; execution stays in registered runtime adapter; prompts cannot grant tools.
- **Quality gates (M13.7.5)** — policy at launch; terminal assessment persisted once; preview reads never return unpersisted overall **PASS**.
- **Scoring** — deterministic from case PASS/FAIL; ERROR cases excluded from quality score.
- **Cost gates** — **INDETERMINATE** when pricing incomplete (`unpricedModelCalls > 0`).

## Migration considerations

| Migration | Purpose |
| --- | --- |
| Through **`0028_playground_memory_restriction`** | Prior M13.7 playground work |
| **`0029_evaluation_quality_gate_slice`** | `evaluation_runs.quality_gate_policy`, `evaluation_run_gate_assessments` |

Operators upgrading from pre-M13.7.5 builds must migrate through **`0029`**. Declarative manifest fields require **no** Postgres schema change (JSON on `agent_versions`).

Verify: `pnpm db:migrations:verify`.

## Acceptance evidence

| Gate | Status |
| --- | --- |
| All M13 slices merged to `main` (M13.1A through M13.7.5) | **PASS** |
| `pnpm verify:ci:clean` on `main` (includes M13.7.5) | **PASS** (recorded; not re-run for doc-only closeout) |
| Per-slice automated tests | **PASS** — see [`M13_ACCEPTANCE_SUMMARY.md`](M13_ACCEPTANCE_SUMMARY.md) |
| Playwright browser tests (Console) | **Present** — operator/local; not bundled as single mandatory CI gate |
| REST/architecture documentation | **PASS** — this closeout updates contracts and flow docs |

## Known limitations and deferred scope

**In scope but partially evidenced**

- M13.7.5 gate **INDETERMINATE** Console UX — domain tests **PASS**; manual browser **NOT EXECUTED**.
- Playwright does not cover quality-gate launch/detail end-to-end.

**Deferred product (not M13)**

- LLM-as-judge evaluators, human review queues, regression baselines ([`PRODUCT_SCOPE.md`](../product/PRODUCT_SCOPE.md) long-term).
- OIDC, MFA, enterprise identity (Community/Enterprise roadmap).
- Runtime Protocol V1 changes for remote declarative runtimes (ADR-009 deferred).
- Dynamic plugin registry / executable manifest fields.

## Outstanding risks

| Risk | Mitigation |
| --- | --- |
| Console browser regressions slip past CI | Playwright suites exist per slice; branch-impact can run affected browser tests; optional future unified CI job |
| Operators confuse execution **COMPLETED** with gate **PASS** | Document lifecycle vs verdict distinction; Console shows both |
| Incomplete model pricing yields **INDETERMINATE** cost gates | Documented in REST + flow; operators must price models or avoid cost rules |

No **blocking** acceptance gaps remain for declaring M13 complete in-repo.

## Related documentation

| Document | Role |
| --- | --- |
| [`M13_ACCEPTANCE_SUMMARY.md`](M13_ACCEPTANCE_SUMMARY.md) | Evidence matrix |
| [`M13_7_5_CLOSEOUT_SUMMARY.md`](M13_7_5_CLOSEOUT_SUMMARY.md) | Scoring/gates slice detail |
| [`ADR-009-declarative-agent-runtime.md`](../adr/ADR-009-declarative-agent-runtime.md) | Declarative runtime decision |
| [`REST_API_V1.md`](../contracts/REST_API_V1.md) | Evaluation HTTP contract |
| [`evaluation-run.md`](../architecture/flows/evaluation-run.md) | Batch evaluation + gates flow |
| [`IMPLEMENTATION_TRACKER.md`](../roadmap/IMPLEMENTATION_TRACKER.md) | Milestone status |

## M13 checklist

| Item | Status |
| --- | --- |
| Declarative manifest + runtime | **PASS** |
| Console Agent / Knowledge / Workflow / Testing studios | **PASS** |
| Evaluation REST + scoring + gates | **PASS** |
| Migration `0029` | **PASS** |
| Milestone acceptance summary | **PASS** |
| Contract + architecture docs updated | **PASS** |

**Overall M13:** **COMPLETE** for the Community no-code Console milestone defined by slices M13.1A–M13.7.5 on `main`.
