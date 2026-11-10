# M20.7.4 closeout — Anthropic live builder acceptance

Branch: **`feat/m20-7-4-claude-builder-acceptance`**
Harness: **`m20-7.4`**
Encoding: **`anthropic_records_v1`** (Records V2 strategy)

Cross-reference: [`M20_7_ACCEPTANCE_SUMMARY.md`](M20_7_ACCEPTANCE_SUMMARY.md) · [`M20_7_3_CLOSEOUT_SUMMARY.md`](M20_7_3_CLOSEOUT_SUMMARY.md) · [`../implementation/M20-7-LIVE-BUILDER-VALIDATION.md`](../implementation/M20-7-LIVE-BUILDER-VALIDATION.md)

## Verdict

| Class | Value |
| --- | --- |
| **FUNCTIONAL_ACCEPTANCE_COMPLETE** | **yes (scoped)** — isolated Anthropic generation + refinement probes PASS against `claude-sonnet-5-5` |
| **RELEASE_VERIFICATION_COMPLETE** | **no** — `pnpm verify:ci:clean` is deferred to the human-managed integration checkpoint; no combined M20.7 PR merge |

This closeout does **not** certify builder reliability across prompts, models, or tenants. It records one generation probe and one refinement probe.

## Objective

Deliver operator-controlled, billable Anthropic Builder acceptance for:

- Isolated **generation** (`pnpm acceptance:m20-7:anthropic-probe -- --execute`)
- Isolated **conversational refinement** (`pnpm acceptance:m20-7:anthropic-refinement-probe -- --execute`)

Constraints: official Anthropic Messages API, `claude-sonnet-5-5`, `maxProviderInvocations=1`, no repair, no fallback, no publication, no workflow execution. Canonical `parseBuilderProposalV1` and pre-publication compile remain authoritative after decode.

## Anthropic grammar failure root cause

Anthropic constrained decoding compiles the JSON Schema into a grammar. The canonical BuilderProposal envelope (`BuilderProposalOpenAiJsonSchema`) uses nested `anyOf` unions (NEW vs EXISTING agents, node types, wait variants). Live Messages requests with that envelope returned **`compiled_grammar_too_large`**.

A typed-array compact IR (`anthropic_compact_v1`) reduced unions but still compiled to **17 object nodes** and was also rejected. JSON-string blobs were rejected as a design choice: they drop constrained generation, still consume output tokens, and move invalid structure into unconstrained text.

## Canonical vs Compact V1 vs Records V2

| Encoding | Wire name | Shape | Live Anthropic result |
| --- | --- | --- | --- |
| Canonical | `BuilderProposalOpenAiJsonSchema` | Nested object + `anyOf` unions | `compiled_grammar_too_large` |
| Compact V1 | `anthropic_compact_v1` | Typed arrays / per-kind objects (~17 object nodes) | `compiled_grammar_too_large` |
| Records V2 | `anthropic_records_v1` | One homogeneous `records` array of primitives (two object nodes, no unions) | **accepted** (HTTP 200) |

OpenAI and Gemini continue to use the **canonical structured-output envelope** (`jsonSchemaForBuilderProvider` returns `BuilderProposalOpenAiJsonSchema` for those providers).

## Why Records V2 works

`anthropic_records_v1` is a homogeneous record with fixed keys (`kind`, `id`, `role`, `name`, `label`, `text`, `ref`, `ref2`, `n1`–`n5`, `flag`, `flag2`, `ord`). Unused strings are empty; unused integers are `0`. The provider schema has two object nodes and no unions, so Anthropic grammar compilation succeeds.

Decode is fail-closed (unknown kinds, extra keys, duplicates, populated unused fields). After decode, **`parseBuilderProposalV1`** and **`compileBuilderProposalPrePublication`** are unchanged.

## Revision provenance (important)

Live artifacts record `sourceCommit` **`3f634df6c2d97dca3533c2e17fdebf07b9d40bbc`** (HEAD = M20.7.1–M20.7.3 merge `#104`). Both PASS runs executed with **uncommitted M20.7.4 code** in the working tree (records IR, Anthropic adapter, refinement harness). Do **not** treat `sourceCommit` as the complete implementation that produced the PASS.

The refinement artifact already records this:

- `provenance.workingTreeDirty: true`
- `provenance.uncommittedCodeNote` / `notes` state that `sourceCommit` identifies HEAD only

This closeout does **not** rewrite the live JSON files.

## Generation live evidence

Local artifact (gitignored, preserved unchanged): `artifacts/m20-7/anthropic-generation-probe.json`

| Field in artifact | Value |
| --- | --- |
| `outcome` | **BUILDER_GENERATION_PASS** |
| `provider` | **ANTHROPIC** |
| `modelId` | **claude-sonnet-5-5** |
| `structuredOutputWire` | `outputConfigJsonSchema` |
| `providerAttempts` | **1** |
| `repairAttempted` | **false** |
| `httpStatus` | **200** |
| `builderGenerationPass` | **true** |
| `providerResponseAccepted` | **true** |
| `invocationAttempted` | **true** |
| `latencyMs` | 7660.02 |
| `measuredUsage` | 3344 input / 941 output (`usageMeasured: true`) |
| `budgets.maxProviderInvocations` | 1 |
| `budgets.maxEstimatedCostUsdMicros` | 250000 |
| `sourceCommit` | `3f634df6c2d97dca3533c2e17fdebf07b9d40bbc` |
| `harnessVersion` | `m20-7.4` |

Operator-confirmed (not stored in the JSON): CLI **exit 0**. Artifact does **not** contain rubric scores, `recordsEncoding`, publication flags, or workflow-run counts.

Known diagnostic anomaly in this preserved file: `builderErrorCode` is **`UNKNOWN_BUILDER_FAILURE`** despite PASS. See [Success diagnostic](#success-diagnostic).

## Refinement live evidence

Local artifact (gitignored, preserved unchanged): `artifacts/m20-7/anthropic-refinement-probe.json`

| Field in artifact | Value |
| --- | --- |
| `outcome` | **BUILDER_REFINEMENT_PASS** |
| `provider` | **ANTHROPIC** |
| `modelId` | **claude-sonnet-5-5** |
| `recordsEncoding` | **anthropic_records_v1** |
| `isolatedBaseline` | **canonical_fixture** |
| `providerAttempts` | **1** |
| `repairAttempted` | **false** |
| `httpStatus` | **200** |
| `builderHttpOk` | **true** |
| `canonicalValidationOk` | **true** |
| `compilerValidationOk` | **true** |
| `requestedModificationApplied` | **true** |
| `existingNodesPreserved` | **true** |
| `rubricScore` | **2** (`rubricReasons: []`) |
| `builderRefinementPass` | **true** |
| `providerResponseAccepted` | **true** |
| `latencyMs` | 5074.06 |
| `measuredUsage` | 3957 input / 613 output (`usageMeasured: true`) |
| `provenance.liveGenerationRerun` | **false** |
| `provenance.generationArtifactRetained` | **true** |
| `budgets.maxProviderInvocations` | 1 |
| `budgets.maxEstimatedCostUsdMicros` | 250000 |

Operator-confirmed (not stored in the JSON): CLI **exit 0**. Artifact does **not** contain proposal bodies, prompts, or workflow-run counts. Integration execute path asserts `countWorkflowRuns` unchanged; that assertion is not duplicated inside the JSON.

Same preserved diagnostic anomaly: `builderErrorCode` is **`UNKNOWN_BUILDER_FAILURE`** despite PASS.

## Provider token usage and estimated costs

Harness rates (`scripts/acceptance/m20-7/lib/pricing.mjs`, `pricingVersion` `m20-7.4-2026-11-09`, `claude-sonnet-5-5`): **2.00 USD / 1M input**, **10.00 USD / 1M output** (micro-USD 2_000_000 / 10_000_000). Estimates are not an Anthropic invoice.

| Probe | Input | Output | Input µUSD | Output µUSD | Subtotal µUSD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Generation | 3344 | 941 | 6688 | 9410 | **16098** (~$0.0161) |
| Refinement | 3957 | 613 | 7914 | 6130 | **14044** (~$0.0140) |
| **Total** | **7301** | **1554** | **14602** | **15540** | **~30142** (~**$0.0301**) |

Configured cap: **250000 micro-USD** ($0.25). Worst-case reservation at 8192/2048 tokens: **36864 micro-USD**.

## Success diagnostic

Root cause: `sanitizeBuilderGenerationFailure` always sets

`builderErrorCode: String(parsed.errorCode ?? "UNKNOWN_BUILDER_FAILURE")`.

Probe artifact builders called that helper on HTTP 200 / `ok: true` bodies (to copy usage) and copied `failure.builderErrorCode` onto the artifact.

Fix (this closeout, **not** applied to the preserved live JSON): `probeArtifactBuilderErrorCode` omits the field when `parsed.ok === true`. Regression tests cover successful refinement, provider failure, decoder failure, canonical validation failure, and compiler failure.

`UNKNOWN_BUILDER_FAILURE` remains the sanitizer sentinel for **unsuccessful** bodies that lack `errorCode`.

## Canonical safety guarantees

- Decode rejects extra keys, unknown encodings/kinds, duplicate meta/agent/node identities, malformed equals/wait fields, and populated unused fields.
- Unauthorized tool version ids fail as `UNAUTHORIZED_OR_UNKNOWN_RESOURCE_REFERENCE` (catalog + compiler).
- Cross-workspace isolation remains catalog/compiler policy (`UNAUTHORIZED_OR_FOREIGN_RESOURCE`); prompts cannot grant permissions.
- Builder generate/refine are read-only aside from model inference (no publication, no Run/WorkflowRun creation).
- Provider diagnostics are token-sanitized; probe artifacts forbid proposal bodies, instructions, and API-key-shaped strings.
- `anthropic-workspace-id` is sent when the connection/adapter is configured; identity-linked keys still require a valid workspace header.

## Security review (`anthropic_records_v1`)

| Topic | Finding |
| --- | --- |
| Strict decoding | Fail-closed; no silent defaults for unknown keys/kinds |
| Unknown/duplicate records | Rejected (`unknown record kind`, duplicate meta/ord/ref/key) |
| Malformed references | Canonical parse / compiler hard-fail |
| Unauthorized tools | Compiler `UNAUTHORIZED_OR_UNKNOWN_RESOURCE_REFERENCE` |
| Cross-workspace isolation | Workspace-scoped catalog + foreign-resource compile codes |
| Secrets in diagnostics | Allowlisted tokens only; operator raw error text is opt-in and local |
| Workspace header | Adapter + connectivity tests cover `anthropic-workspace-id` |
| Silent field loss | Records IR does not carry nested agent JSON Schemas (see limitations) |
| Execution/publication bypass | None observed; probes call generate/refine only |

OpenAI and Gemini still use `BuilderProposalOpenAiJsonSchema`.

### Richer agent input/output JSON Schemas

The canonical `BuilderProposalV1` type allows arbitrary `JsonSchemaRecord` for `inputSchema` / `outputSchema`. The **provider-facing NL envelope** (`BuilderProposalOpenAiJsonSchema`) already constrains those fields to `{ "type": "object" }` for OpenAI and Gemini. Records V2 decode hardcodes the same `{ type: "object" }`.

This is a **pre-existing Builder structured-output limitation**, not an Anthropic-only functional gap in the NL path. Records V2 additionally cannot round-trip a richer schema if a non-NL proposal contained one.

## Node DEP0190 (`child_process` `shell: true`)

Windows probe entrypoints spawn `pnpm.cmd` with `shell: true` and a **hardcoded** argv (`vitest`, turbo filter, test file path):

- `scripts/acceptance/m20-7/anthropic-builder-refinement-probe.mjs` (`runVitestProbe`, turbo build)
- `scripts/acceptance/m20-7/anthropic-builder-generation-probe.mjs` (same pattern)
- `scripts/acceptance/m20-7/run.mjs` (`run()`)

`git rev-parse HEAD` uses `execSync` (always a shell) with a constant command string.

**Risk:** Node DEP0190 warns that `spawn`/`spawnSync` with `shell: true` plus an `args` array concatenates arguments for `cmd.exe`. That is unsafe if untrusted input reaches argv.

**This path:** probe CLI flags (`--execute`, `--help`) are parsed separately and are **not** forwarded into spawn argv. Env is passed as `env`, not shell text. Untrusted operator arguments do not reach the shell command line.

No shell-free refactor in this closeout (Windows `.cmd` shims still need a shell to locate `pnpm`). Docker/node script spawns already use `shell: false`.

## Limitations and deferred work

- One generation + one refinement on one model; not a reliability matrix
- Rubric is heuristic (APPROVAL-before-final-AGENT, identity preservation), not LLM-as-judge
- Live JSON still contains the success-path `UNKNOWN_BUILDER_FAILURE` string (preserved)
- Richer agent JSON Schemas are out of NL structured-output scope
- Compact V1 is not shipped; only mentioned as a failed grammar experiment
- Anthropic pricing is operator-declared conservative; invoice may differ
- `pnpm verify:ci:clean` **deferred**
- Combined M20.7 PR merge **deferred** (human)

## Impact inventory

| Area | Role |
| --- | --- |
| `packages/domain/src/builder/builder-proposal-anthropic-records.ts` | Records encode/decode |
| `packages/domain/src/builder/builder-proposal-anthropic-json-schema.ts` | Provider schema + prompt section |
| `packages/domain/src/builder/builder-provider-structured-output.ts` | OpenAI/Gemini canonical vs Anthropic records |
| `packages/domain/src/builder/builder-proposal-model-output-pipeline.ts` | Decode → canonical parse → compile |
| `packages/domain/src/builder/generate-builder-proposal-from-natural-language.ts` | Generation path |
| `packages/domain/src/builder/refine-builder-proposal-from-natural-language.ts` | Refinement path |
| `adapters/model-anthropic/**` | Messages `output_config`, projection, diagnostics, workspace header |
| `adapters/model-openai/**` | Unchanged canonical `response_format.json_schema` |
| `adapters/model-gemini/**` | Unchanged `responseJsonSchema` |
| `packages/model-gateway` | Provider-neutral errors |
| `adapters/model-provider-connectivity` | Anthropic workspace header on connections |
| `apps/web` | Builder limits env, Anthropic wiring |
| `apps/console/test/**` | Probes, scoring, artifact builders |
| `scripts/acceptance/m20-7/**` | Operator probes, pricing, guards |

No workflow orchestrator, worker Run execution, or publication plan changes.

## Verification matrix

Followed [`OSVA_VERIFICATION_STRATEGY.md`](../engineering/OSVA_VERIFICATION_STRATEGY.md) / [`DEVELOPMENT_GATES.md`](../engineering/DEVELOPMENT_GATES.md) / [`BRANCH_VERIFICATION.md`](../engineering/BRANCH_VERIFICATION.md). The repository does not ship `ENGINEERING_VERIFICATION_PLAYBOOK.md`.

Live OpenAI, Gemini, and Claude acceptance were **not** rerun. Probe dry-run integrations write gitignored JSON; live PASS files were backed up and restored after those runs (hashes unchanged).

| Check | Result | Cache |
| --- | --- | --- |
| Prettier `--write` + `--check` (dirty code files) | **PASS** | n/a |
| `turbo lint` + `typecheck` (9 affected packages + graph) | **PASS** (53/53) | **0 cached** (`--force`) |
| Domain Builder unit (`builder-proposal-anthropic-records`, NL generation, diagnostics, OpenAI schema) | **78/78 PASS** | direct vitest |
| `@osva/adapters-model-anthropic` | **38/38 PASS** | direct |
| `@osva/adapters-model-openai` | **9/9 PASS** | direct |
| `@osva/adapters-model-gemini` | **25/25 PASS** | direct |
| `@osva/model-gateway` | **8/8 PASS** | direct |
| `@osva/adapters-model-provider-connectivity` | **2/2 PASS** | direct |
| `@osva-ai/contracts` | **142/142 PASS** | direct |
| Console M20.7 / Builder unit | **82/82 PASS** | direct |
| Web Builder unit (`builder-generation-limits`, `builder-http`) | **12/12 PASS** | direct |
| `pnpm acceptance:m20-7:test` | **52/52 PASS** | direct node:test |
| Console `m20-7-builder-regression.integration.test.ts` | **9/9 PASS** | **direct** (Docker) |
| Anthropic generation probe integration (dry-run) | **1 PASS / 1 skipped** (execute) | **direct** (Docker) |
| Anthropic refinement probe integration (dry-run) | **1 PASS / 1 skipped** (execute) | **direct** (Docker) |
| `node scripts/release/docs-link-check.mjs` | **PASS** (186 files) | n/a |
| `git diff --check` | **PASS** | n/a |
| Live OpenAI / Gemini / Claude rerun | **not run** | — |
| `pnpm verify:ci:clean` | **deferred** | — |

## Working-tree provenance

- **HEAD:** `3f634df6c2d97dca3533c2e17fdebf07b9d40bbc`
- **Branch:** `feat/m20-7-4-claude-builder-acceptance`
- **Working tree:** dirty (M20.7.4 implementation uncommitted)
- **Live artifacts:** gitignored; left byte-for-byte as recorded
- **Git mutations this closeout:** none (no commit, push, PR, or GitHub write)

## Outstanding risks

- Uncommitted implementation is required to reproduce PASS; checking out HEAD alone is **not** the tested code
- Success diagnostic in archived JSON can be misread as a product failure if the closeout note is ignored
- Windows `shell: true` remaining on hardcoded pnpm spawns (DEP0190 warning)
- Grammar limits may regress if the records schema gains nested objects
- Isolated probes are not the two-scenario OpenAI/Gemini smoke harness
