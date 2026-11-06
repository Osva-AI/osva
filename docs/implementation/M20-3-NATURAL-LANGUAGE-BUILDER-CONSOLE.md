# M20.3 — Natural-language builder console

## Status

Implemented slice: control-plane routes, Console BFF, draft UX (read `/workflows/new/describe`), session draft storage, read-only graph preview, server validation, read-only pre-push verification.

## Routes

| Layer | Method | Path |
| --- | --- | --- |
| Control plane | POST | `/v1/builder/proposals/generate` |
| Control plane | POST | `/v1/builder/proposals/validate` |
| Console BFF | POST | `/api/v1/builder/proposals/generate` |
| Console BFF | POST | `/api/v1/builder/proposals/validate` |

## Authorization

- **Generate:** mapped to **EXECUTE** in human access inventory (cost-bearing inference). Requires the same workspace human session + `x-osva-workspace-id` as other control-plane routes.
- **Validate:** mapped to **READ** (compiler-only, no ModelGateway).

## Composition

- `apps/web/src/process.ts` composes `ModelGateway`, `GenerateBuilderProposalFromNaturalLanguage`, and `GetWorkspaceBuilderCapabilityCatalog`.
- `apps/web/src/builder-http.ts` dispatches both routes; generation uses **150s** socket timeout (above M20.2 default 120s total budget).

## Console

- BFF forwards cookies; generation uses **160s** upstream fetch timeout and accepts **422** JSON bodies from the control plane (typed generation failure).
- UI: `/workflows/new/describe` — draft-only; publication disabled with explicit copy.

## Pre-push

- `pnpm verify:pre-push` — read-only committed diff since merge-base, dirty tree check, Prettier `--check`, `git diff --check` on range.
- Optional hook: `node scripts/verification/install-pre-push-hook.mjs enable`

## Deferred (M20.4 / M20.5)

- Publication handoff, full manual topology/schema/tool editors beyond the current subset, conversational refinement.
