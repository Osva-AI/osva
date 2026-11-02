# M18.2 — Adaptive Home

Status: **Local acceptance complete** for M18.2 scope on branch `feat/m18-2-adaptive-home`. Branch gate **`pnpm verify:branch`** (profile `fast`) passes static/unit stages and reports **BLOCKED** until optional integration-profile browser obligations are run (same pattern as M18.1).

## Delivered capabilities

- **Unified Home** at `/overview` (nav label **Home**) with Standard and Advanced presentation preference (`osva.console.homePresentation.v1`, local only).
- **Automatic presentations:** New (empty workspace), Active (existing work), Advanced (explicit preference), Degraded (cannot confirm empty workspace), Loading (queries unsettled).
- **New Home:** Outcome-oriented hero with permission-aware navigation, Getting started preview, readiness cards, quick paths.
- **Active Home:** Welcome, continue working, needs attention, recent activity, quick actions, compact readiness.
- **Advanced Home:** Registry metrics, resource navigation, attention, recent runs, setup panel, workspace metadata.
- **Degraded Home:** Transparent incomplete-data messaging without implying zero resources.
- **No backend changes.** Routes `/overview` and `/onboarding` preserved; `/onboarding` link label on that page still says “Overview” (unchanged).

## State classification semantics

Pure selector: `selectHomePresentation()` in `apps/console/src/client/lib/home-presentation-state.ts`.

| State | Rule (summary) |
| --- | --- |
| **loading** | Workspace not aligned, auth context unsettled, or any required registry/recent-run query unsettled |
| **new** | All four required queries succeeded; zero agents, workflows, and items on loaded recent-run pages |
| **active** | Any agent, workflow, or recent run present on successful loads (even if other queries fail) |
| **advanced** | User preference `advanced` after loading settles |
| **degraded** | Required query failure (or auth context error) prevents confirming an empty workspace; does not claim “no resources” |

Counts and attention remain truthful: full registry lists vs paginated recent-run pages; WAITING is not labeled as user approval without evidence.

## Files changed (vs `origin/main`)

**30 paths** on branch impact map (see `artifacts/verification/branch-verification.json` after `pnpm verify:branch`).

- **State / data:** `home-presentation-state.ts`, `home-presentation-preference.ts`, `use-home-page-data.ts`, `use-home-presentation-preference.ts`
- **Route:** `overview-page.tsx` → Home orchestrator
- **UI:** `components/home/*`, `styles.css`
- **Tests:** `home-*`, `home-page.test.tsx`, `overview-page.test.tsx`, `app-shell.test.tsx`, `m18-2-browser.*`, `m18-1a-browser-helpers.ts`, `m12-3` / `m13-4` browser heading → Home

**Not committed:** `apps/console/artifacts/m18-2-browser/*.png`, generated verification JSON under `artifacts/verification/`.

## Test results

### Focused M18.2 (final review)

| Command | Result |
| --- | --- |
| `vitest run test/home-page.test.tsx test/app-shell.test.tsx test/home-presentation-state.test.ts` | **PASS** (29 state + home + shell tests in focused runs) |
| `vitest run --config vitest.integration.browser.config.ts test/integration/m18-2-browser.integration.test.ts` | **PASS** (New / Active / Advanced / Degraded, themes, 1440 / 768 / 390, overflow, keyboard) |

### `pnpm verify:branch` (profile `fast`, 2026-11-02)

| Stage | Result |
| --- | --- |
| Format write / check | PASS |
| Lint (`@osva/console`) | PASS |
| Typecheck | PASS |
| Build | PASS |
| Test (`@osva/console`) | PASS (full console unit/component suite) |
| Console navigation regression | PASS |
| Git diff check | PASS |
| **Readiness** | **BLOCKED** — obligations NOT RUN |

### Outstanding integration obligations

From branch impact map (not M18.2-specific; process flags):

1. **M16.3 first-agent onboarding browser** — `m16-3-browser.integration.test.ts` (`requiresDocker: true`)
2. **Console browser smoke** — `m13-6-browser.integration.test.ts` (and related m13-5 in map)

Clear when practical:

```bash
pnpm verify:branch -- --profile=integration
```

M18.2 slice evidence: **mocked-API** `m18-2-browser.integration.test.ts` (no Docker).

## Screenshot evidence

Local only (do not commit): `apps/console/artifacts/m18-2-browser/`

| File | Scene |
| --- | --- |
| `desktop-1440-new-light.png` | New Home, light (hero with **Explore the Console** aside) |
| `desktop-1440-new-dark.png` | New Home, dark |
| `desktop-1440-advanced-dark.png` | Advanced presentation |
| `desktop-1440-active-dark.png` | Active workspace |
| `desktop-1440-degraded-dark.png` | Degraded state |
| `tablet-768-new-light.png` | Tablet layout |
| `mobile-390-new-light.png` | Mobile layout |

## Deferred M18.3 work

- Functional **goal discovery**: natural-language goal input, verified example matching, and submission behavior (removed from M18.2 hero; no fake inputs).

## Known limitations

- Getting started **preview** uses a bounded run page (same limit as Home recent runs for onboarding queries); `runsListIncomplete` surfaces “not verified” copy when history may extend beyond the loaded page.
- Agent “recent activity” on Active Home uses recent runs, not edit timestamps (agents registry exposes `createdAt` only).
- Advanced presentation still includes the full **Workspace setup** diagnostic table for operators.
- Branch **BLOCKED** until integration-profile browser obligations are run or accepted as reviewer follow-up per team policy.

## PR readiness

**Recommend ready for PR** after commit: M18.2 acceptance doc, focused tests, and M18.2 browser harness pass; `verify:branch` fast profile passes local gates with documented integration follow-ups. No commit/push performed in this closeout step unless explicitly requested.
