# M18.4 Unified Guided Onboarding — Acceptance Summary

Status: **Local slice complete** (mock browser evidence + unit tests). **M16.3 live-stack** onboarding acceptance remains the authoritative real execution gate when Docker is available.

## Reused capabilities (not rebuilt)

- `lib/agent-onboarding.ts` — URL context, progress derivation, step model, developer path
- M13/M16 Agent Studio publish flow, run launch form, Run Detail lifecycle
- `workspace-setup-guidance.ts`, `agent-readiness.ts`, setup/readiness panels
- Home getting-started preview (M18.2), examples catalog handoff (M18.3)
- RBAC helpers (`roleCanWriteControlPlaneResources`, `roleCanExecuteControlPlaneActions`)

## UX and route handoffs

| Surface | Change |
| --- | --- |
| `/onboarding` | Guided layout: progress stepper, primary step card, context banner, collapsible readiness tables, success panel with evidence-based CTAs |
| `/overview` | Unchanged; Home preview links to full guide |
| Agent / AgentVersion / Run Detail | Existing `onboardingSearch` return links preserved |
| `/examples/:id` | Getting started link carries validated `exampleId` query param |

Skip / Home / developer path do not bypass server permissions.

## State and evidence semantics

- **Journey states:** `loading`, `not_started`, `in_progress`, `ready_to_test`, `running`, `succeeded`, `failed`, `indeterminate`
- **Step visuals:** complete, current, upcoming, needs_attention, not_verified
- **Success:** terminal `SUCCEEDED` Run matching explicit or resolved `agentId` / `agentVersionId` only
- **Explicit invalid `agentVersionId`:** no silent fallback to another published version
- **Run list pagination:** `runsListIncomplete` prevents inferring history from one page
- **Inspect complete:** requires `SUCCEEDED`, not submission alone

## Resumption and skip

- Shareable URLs: `agentId`, `agentVersionId`, `runId`, optional `exampleId` (catalog-validated for display only)
- No credentials or secrets in query params or localStorage beyond existing workspace selection
- Workspace switch recomputes from API queries scoped to selected workspace

## Tests

| Command | Result |
| --- | --- |
| `pnpm --filter @osva/console exec prettier --write` (changed files) | Run at closeout |
| `pnpm --filter @osva/console test test/agent-onboarding.test.ts` | Unit coverage for progress, journey state, invalid version, run phases |
| `pnpm --filter @osva/console test test/agents-page.test.tsx` | Onboarding route smoke |
| `vitest … m18-4-browser.integration.test.ts` | Mock Playwright UX evidence |
| `pnpm verify:branch` (fast, local closeout) | Format/lint/typecheck/build/**416** console tests/targeted regression/docs links/harness **PASS**; readiness **BLOCKED** until integration obligations run |
| `vitest … m18-4-browser.integration.test.ts` | **PASS** (mock Playwright) |
| `node --test scripts/verification/branch-impact.test.mjs` | **PASS** (11/11, direct) |
| `vitest … m16-3-browser.integration.test.ts` | **PASS** (live stack, exit 0, ~108s) |
| `vitest … m13-5-browser.integration.test.ts` | **PASS** (exit 0, ~57s) |
| `vitest … m13-6-browser.integration.test.ts` | **PASS** (4 tests, exit 0, ~107s) |

## Mock vs live evidence

- **Mock (M18.4):** Playwright against `vite preview` with routed Console API — UX, RBAC presentation, responsive/themes, context URL behavior.
- **Live (M16.3):** **PASS** on `feat/m18-4-guided-onboarding` (2026-11-02) — real model setup, Agent Studio publish, Run to `SUCCEEDED`, return to guided onboarding + refresh persistence (selectors updated for primary-step UI).
- **Live (M13.5/M13.6):** **PASS** — Console browser smoke with Postgres/Valkey fixtures.

## Screenshot paths

`apps/console/artifacts/m18-4-browser/` (gitignored)

## Known limitations

- Worker health not inferred from Console API (unchanged)
- Model connection registration does not prove live provider credentials
- Browser mock does not execute real Runs
- Optional workflow step appears after first `SUCCEEDED`, not as a blocking stage

## Deferred (M18.5+)

- Not started per milestone scope
