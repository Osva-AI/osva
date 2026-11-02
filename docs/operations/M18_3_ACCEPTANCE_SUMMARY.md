# M18.3 — Outcome Discovery and Verified Examples

Status: **Local acceptance complete** for M18.3 scope on branch `feat/m18-3-outcome-discovery` (baseline `128035d` / M18.2 on main).

## Delivered capabilities

- **Static, typed example catalog** in the Console (12 curated entries from public `osva-examples`, no backend or LLM).
- **Goal discovery on New Home:** keyword matching, suggested prompts, ranked recommendations with “Why this matches”, weak/no-match honesty.
- **Browse experience** at `/examples` with search (`q`), category, and complexity URL params.
- **Example detail** at `/examples/:exampleId` with prerequisites, limitations, verification badges, allowlisted GitHub README links, permission-aware Console next steps.
- **Navigation:** **Examples** under Start; discover links on Active/Advanced Home; featured examples on New Home.
- **No** automatic install/import/deploy, no goal text sent externally, no persistence of goal text beyond in-session React state.

## Catalog provenance

| Field | Value |
| --- | --- |
| Repository | `Osva-AI/osva-examples` |
| Audited commit | `8c21466162bef3817fcec2ca838302ad75f61552` |
| README links | Built via `buildExampleReadmeUrl()` + `isAllowedOsvaExamplesUrl()` allowlist |

### Included examples (12)

| ID | OSVA target | Fixture-backed | Offline CI/smoke (repo) |
| --- | --- | --- | --- |
| `01-minimal-agent` | 1.0.0 | No | Yes (`pnpm test:examples` in osva-examples CI) |
| `03-durable-review-workflow` | 1.0.0 | No | Yes |
| `04-seo-worker` | 1.0.0 | Yes | Yes |
| `05-research-analyst-worker` | 1.0.0 | Yes | Yes |
| `06-customer-support-worker` | 1.0.0 | Yes | Yes |
| `07-growth-analyst-worker` | 1.0.0 | Yes | Yes |
| `08-product-manager-worker` | 1.0.0 | Yes | Yes |
| `09-founders-office-worker` | 1.0.0 | Yes | Yes |
| `10-incident-response-worker` | 1.0.0 | Yes | Yes |
| `11-growth-operations-worker` | 1.0.0 | Yes | Yes |
| `16-knowledge-rag-agent` | 1.0.0 | Yes | Yes |
| `19-research-report-agent` | **1.1.x** | Yes | Yes (example-local tests; live eval manual) |

**Verification labels in UI**

- **Source documented** — always for catalog entries.
- **Offline CI / smoke** — osva-examples CI runs `pnpm test:examples` (hermetic); does **not** prove live deployment against OSVA main.
- **Live integration verified** — **not** claimed for any catalog entry (`liveIntegrationVerified: false`).
- **Live run is manual** — shown when live verification is not evidenced.

## Goal matching algorithm

Module: `apps/console/src/client/lib/goal-discovery-matching.ts`

1. Normalize goal: lowercase, strip punctuation, collapse whitespace.
2. Tokenize: split on spaces, drop stop words, dedupe, split hyphenated tokens.
3. Score each catalog entry: keyword hits weight **2**, title word hits weight **1**; simple suffix variants (`-ing`, `-ed`, plural `s`).
4. Sort by score descending, tie-break by `exampleId` ascending; return top **5** by default.
5. **Reliable match** when top score ≥ **3** (`GOAL_MATCH_MIN_RELIABLE_SCORE`); otherwise show **Weak match** warning.
6. Empty/whitespace → no matches.

## UX interactions

- New Home hero: goal field, **Find matching examples**, Enter to submit, suggested goal chips, result cards, browse/build fallbacks.
- `/examples`: filter form, shareable query params, read-only cards.
- Detail page: evidence badges, external README (new tab), Console next steps gated on `requiresWrite`.

## Security boundaries

- Catalog is static/global; workspace APIs unchanged.
- External URLs limited to allowlisted `github.com/Osva-AI/osva-examples` paths (audited SHA).
- Goal text stays in the browser; no new network endpoints for discovery.

## Routes / components added

| Area | Paths |
| --- | --- |
| Routes | `examples-page.tsx`, `example-detail-page.tsx`; `/examples`, `/examples/:exampleId` in `app.tsx` |
| Lib | `osva-examples-catalog.ts`, `osva-examples-links.ts`, `goal-discovery-matching.ts` |
| UI | `components/examples/*`, `home-goal-discovery.tsx`, `home-featured-examples.tsx`; updates to `home-hero.tsx`, Active/Advanced/New presentations |
| Nav | `console-navigation.ts` — Examples under Start |
| Styles | M18.3 block in `styles.css` |

## Tests

### Focused M18.3 (consolidated acceptance)

| Command | Result |
| --- | --- |
| `vitest run test/goal-discovery-matching.test.ts test/osva-examples-catalog.test.ts test/examples-page.test.tsx test/home-page.test.tsx` | **PASS** (29 tests — short queries, growth overlap, unknown id, malformed filters, viewer/write gates, live-badge honesty) |
| `vitest run --config vitest.integration.browser.config.ts test/integration/m18-3-browser.integration.test.ts` | **PASS** (slice evidence; not a branch-gate obligation) |

### `pnpm verify:branch` (profile `fast`, merge-base `128035d`, 2026-11-02)

Authoritative report: `artifacts/verification/branch-verification.json`.

| Stage | Status |
| --- | --- |
| FORMAT WRITE | **PASS** |
| FORMAT CHECK | **PASS** |
| LINT | **PASS** |
| TYPECHECK | **PASS** |
| BUILD | **PASS** |
| TEST (`@osva/console`, 414 tests) | **PASS** |
| TEST Console navigation and route regression | **PASS** (includes `/examples` SPA deep links after timeout fix in `spa-routing.test.ts`) |
| DOCS LINK CHECK | **PASS** |
| GIT DIFF CHECK | **PASS** |
| M16.3 first-agent onboarding browser acceptance | **NOT RUN** |
| Console browser acceptance smoke | **NOT RUN** |
| **Readiness** | **BLOCKED** (exit code 2 — obligations outstanding; not a merge-ready signal) |

Clear optional obligations when practical:

```bash
pnpm verify:branch -- --profile=integration
```

**Defect fixed during closeout:** `spa-routing.test.ts` default 10s timeout could fail under branch-gate load on Windows; raised to 30s and added `/examples` deep-link assertions.

## Browser screenshots (local only — do not commit)

Directory: `apps/console/artifacts/m18-3-browser/`

- `desktop-1440-new-light-discovery.png`
- `desktop-1440-new-light-seo-results.png`
- `desktop-1440-examples-browse-light.png`
- `desktop-1440-example-detail-light.png`
- `desktop-1440-new-dark-no-match.png`
- `desktop-1440-active-dark.png`
- `desktop-1440-advanced-dark.png`
- `tablet-768-new-light.png`
- `mobile-390-new-light.png`

## Known limitations

- Catalog is curated (12 of 19 osva-examples), not exhaustive.
- Keyword matching is not semantic NLU; ambiguous goals may yield weak matches.
- Example 19 requires OSVA **1.1.x**; remainder target **1.0.0** per osva-examples `COMPATIBILITY.md`.
- No one-click import, CLI generation from Console, or remote code execution.
- Live integration against current OSVA main is **not** asserted for examples.

## Deferred (out of M18.3)

- LLM goal interpretation, embeddings, marketplace/install flows.
- Backend catalog sync, automatic template import, M18.4 / M20 work.

## PR readiness

- **Fast-profile branch gate:** all executed checks **PASS**; readiness **BLOCKED** until integration-profile browser obligations are run or waived by process.
- M18.3 slice evidence: unit/component tests above + `m18-3-browser.integration.test.ts` (local screenshots under `apps/console/artifacts/m18-3-browser/`, gitignored).
- **Not committed/pushed** per milestone instructions; ready for human review and a single product commit when requested.
