# M18.5 Acceptance Summary â€” Agent Studio UX Refinement

Baseline: `main` @ `64bafa1`
Branch: `feat/m18-5-agent-studio`

## Stabilization closeout (final)

### SPA routing timeout â€” diagnosis and resolution

**Symptom:** `test/spa-routing.test.ts` hit the per-test **30s** limit during `pnpm verify:branch` (419/420 console tests passed in the prior run).

**Cause (evidence):**

1. The test used `legacyApiKeyMode: true` with `osvaApiKey`, so `/api/v1/agents` resolved a **legacy upstream client** and `listAgents()` could **block on TCP** to `http://127.0.0.1:3000` (no control plane in unit tests). Under full-suite parallelism this often exceeded 30s.
2. With `legacyApiKeyMode: false`, the human-session client path could still hang on the same API probe.
3. Failure was **not** M18.5 UI code; it was **API fallback verification** on the last fetch in the test. SPA deep-link fetches completed; the hang was isolated to `/api/v1/agents`.

**Fix (`apps/console/test/spa-routing.test.ts`):**

- Disable legacy API key mode for this fixture.
- Inject a **minimal `testClient`** so `/api/v1/agents` returns JSON immediately (still asserts no SPA `id="root"` in the body).
- Add **5s per-request** `fetch` abort with labeled errors (which path failed).
- Use **`closeAllConnections()`** before `server.close()` and remove temp dirs in `afterEach`.
- Loop SPA paths with explicit labels (same assertions).

**Repeatability:** `pnpm exec vitest run --config vitest.config.ts test/spa-routing.test.ts` â€” **5/5 PASS** sequentially (~11â€“17s each). Included in full `@osva/console` test job during branch gate (**PASS**, ~594ms for this file).

---

### Agent Studio invariants reviewed

| Invariant | Evidence |
| --- | --- |
| **A. Manifest round-trip** | `agent-manifest-roundtrip.test.ts` (unknown fields preserved); `agent-studio.test.tsx` (Guided â†” Advanced instructions; invalid JSON preserved across mode switch). Guided patches no-op when JSON invalid (`declarative-agent-studio-editor.tsx`). Review uses same `manifestText` as publish routes. |
| **B. Partial publish failure** | `agent-create-page.tsx` stores `createdAgentId`, sets `partialPublishFailure`, recovery banner with agent link. `agent-studio.test.tsx` asserts **one** Agent POST and **two** version POSTs on retry; no success navigation on first failure. |
| **C. Existing version safety** | `agent-version-create-page.tsx` does not clone defaults when `?from=` errors. `agent-studio.test.tsx` expects `EmptyState` and no instructions field. Copy-from-source test unchanged for happy path. |

**Note:** Partial-failure recovery is **in-session** (React state). A full page refresh after Agent create but before version publish is not persisted client-side (no localStorage manifest); user recovery is via the existing Agent detail route if they noted the ID â€” unchanged by design for this slice.

---

## 1. Initial impact inventory

| Area | Finding |
| --- | --- |
| Authoring surface | Single `manifestText` draft on create and new-version routes; `DeclarativeAgentStudioEditor` is the shared guided/advanced UI. |
| Canonical manifest | `declarative-agent-manifest.ts` owns extract/patch/validate; tool/knowledge/memory selectors mutate the same JSON text. |
| Gaps before M18.5 | Advanced mode duplicated the full guided form; no section navigation; weak assurance copy; create flow could orphan Agent rows on version failure; explicit `?from=` source errors fell back to defaults; model selector did not resolve existing version IDs; RBAC copy omitted DEVELOPER/OWNER. |
| Developer path | `AgentVersionCreatePage` developer surface + `/agents/new/developer` unchanged in scope; separate from declarative studio layout. |
| Tests | M13.3 live-stack browser suite; component tests in `agent-studio.test.tsx`; manifest unit tests in `declarative-agent-manifest.test.ts`. |

## 2. Existing defects identified

1. **Partial publish (new agent)** â€” Agent create succeeded while first AgentVersion create failed â†’ retry could POST another Agent.
2. **Missing source version** â€” `?from=<id>` 404/inaccessible still initialized a default declarative template.
3. **Advanced mode UX** â€” Guided fields and JSON were both rendered in advanced mode (confusing, not progressive disclosure).
4. **Model selection** â€” Bound `modelProfileVersionId` not resolved against workspace catalog when profile `<select>` was empty.
5. **RBAC messaging** â€” UI text said EDITOR/ADMIN only; WRITE also includes DEVELOPER and OWNER per contracts.
6. **SPA routing test flake** â€” Legacy/upstream API probe could hang until global timeout under suite load.

## 3. Product UX improvements

(See prior sections â€” sectioned studio, assurance copy, partial publish recovery, model selector, execution blur-commit, review panel.)

## 4â€“8. Architecture, validation, publish, security

Unchanged from implementation slice; see git diff and component list below.

## 9. Components and files changed

**UI:** `declarative-agent-studio-editor.tsx`, `model-profile-version-selector.tsx`, `agent-create-page.tsx`, `agent-version-create-page.tsx`, `styles.css`

**Lib:** `agent-studio-sections.ts`, `agent-studio-assurance.ts`, `control-plane-access.ts`

**Tests:** `agent-studio.test.tsx`, `agent-manifest-roundtrip.test.ts`, `spa-routing.test.ts`, `m18-5-browser.integration.test.ts`, `m18-5-browser-helpers.ts`

**Docs:** this file

## 10. Verification commands and exit codes

| Step | Command | Exit | Result |
| --- | --- | ---: | --- |
| SPA routing (focused Ã—5) | `pnpm --filter @osva/console exec vitest run --config vitest.config.ts test/spa-routing.test.ts` | 0 | **PASS** (5 sequential runs) |
| Agent invariants | `pnpm exec vitest run test/agent-studio.test.tsx test/agent-manifest-roundtrip.test.ts` (from `apps/console`) | 0 | **PASS** (10 tests) |
| Live M13.3 | `pnpm --filter @osva-ai/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m13-3-browser.integration.test.ts` | 0 | **PASS** (~157s) |
| Live M16.3 | `pnpm --filter @osva-ai/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m16-3-browser.integration.test.ts` | 0 | **PASS** (~273s) |
| Mocked M18.5 browser | `pnpm exec vitest run --config vitest.integration.browser.config.ts test/integration/m18-5-browser.integration.test.ts` | 0 | **PASS** (~23s) |
| Branch gate (fast) | `pnpm verify:branch` | **2** | **BLOCKED** â€” all executed stages **PASS**; integration obligations **NOT RUN** by fast profile (see below) |
| `verify:ci:clean` | â€” | â€” | **NOT RUN** (no local justification) |

### `pnpm verify:branch` (2026-11-02, ~19.4 min, exit **2**)

| Stage | Status | Duration |
| --- | --- | --- |
| FORMAT WRITE | **PASS** | 21.1s |
| FORMAT CHECK | **PASS** | 11.7s |
| LINT | **PASS** | 50.8s |
| TYPECHECK | **PASS** | 166.6s |
| BUILD | **PASS** | 69.0s |
| TEST (`@osva/console`) | **PASS** | 648.1s (420 tests; includes `spa-routing.test.ts`) |
| TEST Console navigation regression | **PASS** | 18.0s |
| TEST Agent manifest and binding | **PASS** | 25.2s |
| DOCS LINK CHECK | **PASS** | 0.9s |
| GIT DIFF CHECK | **PASS** | 0.35s |
| M16.3 first-agent browser (harness obligation) | **NOT RUN** | 0ms (fast profile) |
| Console browser smoke (harness obligation) | **NOT RUN** | 0ms (fast profile) |

**Readiness:** `BLOCKED` â€” not unconditional merge-ready per harness (`artifacts/verification/branch-verification.json`). Live M13.3/M16.3 were run **directly** (above) and **PASS**; to clear harness obligations use `pnpm verify:branch -- --profile=integration` or CI.

## 11. Browser screenshot evidence (mocked M18.5)

Under `apps/console/artifacts/m18-5-browser/` (not committed): desktop/tablet/mobile + light/dark captures from mocked acceptance.

## 12. Live integration results

| Suite | Result | Notes |
| --- | --- | --- |
| M13.3 Agent Studio | **PASS** | Real API: model setup, agent create, validation UX (`#studio-instructions`) |
| M16.3 first-agent onboarding | **PASS** | Publish, run, SUCCEEDED output path |
| M18.5 mocked browser | **PASS** | UI/layout only; not a substitute for M13.3/M16.3 |

## 13. Known limitations

- Fast-profile `verify:branch` exit **2** until integration profile or CI runs obligated browser suites through the harness.
- Partial publish recovery is session-scoped (no draft persistence in localStorage).
- `verify:ci:clean` not run locally.

## 14. Git status and diff summary

```
 M apps/console/... (7 files, +917/-236)
?? apps/console/src/client/lib/agent-studio-*.ts, control-plane-access.ts
?? apps/console/test/agent-manifest-roundtrip.test.ts
?? apps/console/test/integration/m18-5-browser*
?? docs/operations/M18_5_ACCEPTANCE_SUMMARY.md
```

## 15. PR readiness

- **Product / tests:** Stabilization complete; SPA flake fixed; live M13.3 + M16.3 **PASS**.
- **Merge gate:** Run `pnpm verify:branch -- --profile=integration` or rely on CI for harness **READY** (exit 0).
- **Do not:** commit, push, merge, deploy, or start M18.6 per milestone instructions.
