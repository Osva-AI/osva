# M18.1 — Console design foundation (shell + shared UI)

Status: **Local acceptance complete** for M18.1A/M18.1B scope. Branch gate **`pnpm verify:branch`** reports **BLOCKED** until optional integration-profile browser obligations are run (see below). Suitable for **one consolidated PR** with documented follow-ups.

## Scope delivered

### M18.1A — Shell and design tokens

- Unified navigation (Start, Build, Resources, Operate, Workspace) with permission-aware admin links.
- Collapsible desktop sidebar, mobile drawer (Menu, Escape, focus restore, `inert` when closed).
- Workspace switcher, account summary, sign-out; redirect off inaccessible admin routes after workspace switch.
- Light / dark / system theme preference (`localStorage` + inline boot script + `data-theme` tokens).
- Semantic CSS tokens with legacy `--bg` / `--accent` aliases; reduced-motion support.
- Focus-visible rings and landmark structure.

### M18.1B — Shared UI and controlled adoption

- **`components/ui/`**: `Button`, `LinkButton`, `IconButton`, field primitives, `PageHeader`, `SectionPanel`, `DataTableRegion`, `ConfirmDialog`, `InlineMessage`.
- Refined **LoadingBlock**, **EmptyState**, **StatusChip**, **JsonView** toolbar.
- Representative adoption: app shell, Overview, Agents, Model connections, Workspace Access (**Remove** → `ConfirmDialog`).
- No new npm UI libraries, no API/BFF changes, no workflow editor refactors.

## Architecture decisions

| Decision | Rationale |
| --- | --- |
| CSS tokens + small React wrappers | Keeps bundle lean; matches existing Vite/CSS architecture. |
| `localStorage` for theme/sidebar only | Not authorization; workspace auth unchanged (session + TanStack Query). |
| Mocked-API Playwright harness | Fast M18 regression without Postgres/Valkey for shell/UI slices. |
| Partial `ConfirmDialog` adoption | Proves accessible destructive flow; other confirms remain `window.confirm` until later slices. |
| Legacy CSS class aliases | Avoids repo-wide button/table rewrites in M18.1. |

## Files changed (vs `origin/main`)

**35 paths** under `@osva/console` (see `artifacts/verification/branch-verification.json`). Summary:

- **Shell:** `app-shell.tsx`, `sidebar-nav.tsx`, `nav-icons.tsx`, `console-navigation.ts`, `theme-preference.ts`, `sidebar-preference.ts`, `styles.css`, `index.html`, `main.tsx`
- **UI:** `components/ui/*`
- **Adoption routes:** `overview-page.tsx`, `agents-page.tsx`, `model-connections-page.tsx`, `workspace-access-page.tsx`
- **Feedback:** `loading-block.tsx`, `empty-state.tsx`, `status-chip.tsx`, `json-view.tsx`
- **Tests:** unit/component + `m18-1a-browser-*`, `m18-1b-browser.integration.test.ts`, `test/setup.ts` (`matchMedia` stub)

**Not changed:** `components/workflow/*`, workflow routes, server/BFF, contracts, database.

**Untracked / not for commit:** `apps/console/artifacts/**` (screenshots), `artifacts/verification/**` (generated reports).

## Verification results

### `pnpm verify:branch` (2026-11-02, profile `fast`)

| Stage | Result | Notes |
| --- | --- | --- |
| Format write/check | PASS | 35 files |
| Lint (`@osva/console`) | PASS | Direct execution |
| Typecheck | PASS | ~225s |
| Build | PASS | ~62s |
| Test (`@osva/console`) | PASS | **368** tests, **76** files (~490s; Turbo **36/37 cached**) |
| Console navigation regression | PASS | `spa-routing.test.ts`, `agent-onboarding.test.ts` |
| Git diff check | PASS | |
| **Readiness** | **BLOCKED** | Integration obligations not run |

**Outstanding obligations** (from branch impact map; not M18-specific harness):

1. **M16.3 first-agent onboarding browser** — `m16-3-browser.integration.test.ts` (`requiresDocker: true`)
2. **Console browser smoke** — `m13-6-browser.integration.test.ts` (and related m13-5 in map)

Re-run when Docker/stack available:

```bash
pnpm verify:branch -- --profile=integration
```

Or run obligations individually per `artifacts/verification/branch-verification.json`.

### Additional direct runs (M18.1 closeout)

| Command | Result |
| --- | --- |
| `pnpm --filter @osva/console test` | Included in verify:branch (**368/368** pass) |
| `vitest … m18-1a-browser.integration.test.ts` | **PASS** (mock API + built client) |
| `vitest … m18-1b-browser.integration.test.ts` | **PASS** (mock API + built client) |

## Browser evidence (mocked API)

Paths are local only (gitignored under `apps/console/artifacts/`).

### M18.1A — `artifacts/m18-1a-browser/`

- Desktop 1440: light/dark expanded & collapsed sidebar, workflow graph editor
- Tablet 768 overview, mobile 390 drawer/runs
- Covers: theme init, nav active states, workspace switch, Escape/focus, horizontal overflow checks

### M18.1B — `artifacts/m18-1b-browser/`

- `desktop-light-agents-table.png`, `desktop-dark-agents-table.png`
- `desktop-dark-model-connection-form.png`
- `mobile-testing-studio.png`
- `desktop-dark-remove-member-dialog.png` (accessible **ConfirmDialog**)

**Proven under mock API:** layout, navigation, theme CSS, form/table presentation, dialog chrome, mobile shell.

**Not proven:** real BFF/session flows, live onboarding journey (M16.3), cross-page data mutations beyond mocks.

## Visual review (screenshots)

| Area | Assessment |
| --- | --- |
| Hierarchy & typography | Clear page titles, section labels, muted secondary text |
| Sidebar density | Readable grouped nav; compact mode icon-only with tooltips |
| Light/dark parity | Tokens apply consistently on Overview/Agents; status colors preserved |
| Forms/tables | Model connection fields aligned; table scroll regions usable |
| Button hierarchy | Primary/secondary/destructive distinguishable |
| Dialog | Centered panel, legible copy, destructive styling on confirm |
| Mobile | Drawer + top bar; no obvious overflow in captured runs |
| Workflow canvas | M18.1A graph screenshot shows canvas intact (editors not refactored) |

No material visual defects requiring code changes identified for M18.1 scope.

## Accessibility

- Covered in tests: dialog Escape/focus, form `aria-invalid` / `aria-describedby`, loading `role="status"`, keyboard nav shell tests.
- **Not claimed:** full WCAG 2.2 AA audit.

## Security & regression

- No new secrets in client bundle; existing `secret-leak` / BFF tests pass in console suite.
- Permissions: role-aware nav and workspace admin gating unchanged in logic; `app-shell` + `workspace-access` tests updated for dialog removal.
- Routes: `spa-routing.test.ts` pass (production SPA deep links).
- Theme/sidebar persistence: `theme-preference.test.ts`, `app-shell.test.tsx`.

## Deferred work (post–M18.1)

- M18.2 Adaptive Home and broader route migration to shared UI.
- Replace remaining `window.confirm` with `ConfirmDialog` where appropriate.
- Run **integration-profile** browser obligations (M16.3, M13.6 smoke) before merge if policy requires **READY** from `verify:branch`.
- Optional: wire M18 browser suites into branch impact map as satisfied alternatives for pure shell/UI diffs.

## Recommended PR

**Title:** `feat(console): M18.1 design foundation — shell, tokens, and shared UI`

**Description bullets:**

- Unified Console shell (nav groups, responsive sidebar, themes, workspace safety).
- Semantic design tokens and shared UI primitives with representative page adoption.
- Mocked-API Playwright acceptance for M18.1A/B.
- No backend or workflow editor changes.

**Pre-merge checklist for reviewers:**

1. Review screenshots under `apps/console/artifacts/m18-1a-browser/` and `m18-1b-browser/`.
2. Run `pnpm verify:branch -- --profile=integration` if Docker available (clears BLOCKED obligations).
3. Confirm no accidental commit of `artifacts/` directories.

## Merge-readiness recommendation

**Ready for one PR** as M18.1 design foundation: local fast-profile gate passes all executed checks; M18 mocked browser acceptance passes; workflow/runtime semantics untouched.

Treat **`verify:branch` BLOCKED** as a **process flag** for integration browser suites, not as failure of M18.1 implementation quality. Clear with `profile=integration` when infrastructure is available, or accept as CI/reviewer follow-up if team policy allows M18-only mock browser evidence for this slice.
