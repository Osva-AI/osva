# B6.3B — Guided Connector Setup

## Decision

**Build:** Step-based guided setup route on top of B6.3A catalog + existing workspace connector APIs.

**Reuse:**

- B6.3A pinned catalog snapshot and `connectorKey` workspace matching
- `useCreateConnectorMutation`, `useConnectorCatalogWorkspaceStatus`, version queries
- Workspace connector detail for HTTP append, MCP discovery, and import
- Onboarding stepper visual tokens (`onboarding-guided-stepper-*`)
- Operator STDIO boundary (`OSVA_MCP_STDIO_CONNECTORS_ENABLED`, no Console STDIO forms)

**Not built:**

- Auto connector creation, auto npm install, browser credential storage
- Alternate HTTP bridge for stdio-only published packages
- Second tool-import UI

## UX

- Route: `/tools/connectors/catalog/:catalogConnectorId/setup`
- Entry: **Guided setup** on catalog detail
- Steps (URL `?step=` only): Requirements → Workspace → Transport → Prerequisites → Discover
- Evidence-based journey status (no “Connected” / “provider healthy”)

## STDIO boundary

- Copyable command derived only from catalog `npmPackage` + `publishedVersion`
- Operator install + ConnectorVersion provisioning guidance
- Existing STDIO versions listed read-only; HTTP form not advertised for stdio catalog entries

## Credential security

- Env **names** from catalog with heuristic disclaimers
- No `localStorage` / `sessionStorage` for setup state beyond non-sensitive `?step=`

## Verification (2026-11-14 local)

| Check | Result |
| ----- | ------ |
| Focused B6.3B + B6.3A catalog regression | **31/31** pass |
| `pnpm --filter @osva/console typecheck` | pass |
| `pnpm --filter @osva/console lint` | pass |
| `pnpm --filter @osva/console test` | **720/720** pass |
| Prettier (B6.3B paths) | pass |
| `git diff --check` | pass |
| `pnpm format:check` (repo) | **31** pre-existing failures (unchanged set) |

## B6.3C prerequisites

- Agent ToolVersion binding walkthrough from imported MCP tools
- Execution diagnostics on connector-backed runs
- Optional allowlisted worker package install automation (platform slice)
