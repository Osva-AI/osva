# B6.3D — Native Connector Experience Acceptance

## Feature inventory (B6.3A / B6.3B / B6.3C)

| Slice | Delivered |
|-------|-----------|
| **B6.3A** | 45-entry pinned connector catalog, search/filters, catalog detail, workspace status by `connectorKey`, Examples 19–21 links, provenance SHA |
| **B6.3B** | Guided setup stepper, workspace identity creation, STDIO/HTTP evidence labels, discover handoff to workspace connector detail |
| **B6.3C** | Import handoff panel, `toolVersionIds` navigation hints (revalidated), Agent Studio preselection, Run Detail Tool RunStep guidance |

## Consolidated architecture

Console-only journey; control plane APIs unchanged. PostgreSQL remains authority; ToolGateway mediates execution; catalog snapshot is static JSON at build time (no runtime fetch from npm/GitHub providers).

```text
Catalog (snapshot) → Guided setup → Workspace Connector/Version
  → Discover/Import → ToolVersion → AgentVersion binding → Run → RunSteps
```

## Journey acceptance

| Scenario | Coverage | Evidence |
|----------|----------|----------|
| **A — New setup** | Catalog → guided setup → discover/import → agent handoff | `b6-3-native-connector-acceptance.test.tsx` |
| **B — Existing connector** | tools-imported status, bind without recreate | same + `connector-catalog-setup.test.tsx` |
| **C — Missing prerequisites** | Evidence labels, no fabricated health | `b6-3-native-connector-acceptance.test.ts` |
| **D — Custom key** | No false catalog association | `b6-3-native-connector-acceptance.test.ts`, `connector-workspace-status.test.ts` |

## Security acceptance

Hermetic unit/UI tests assert:

- Cross-workspace `toolVersionIds` hints rejected
- VIEWER cannot create connectors (`connector-catalog-setup.test.tsx`)
- No runs launched from import/bind path (fetch assertions)
- No secrets in handoff URLs
- Catalog JSON contains no credential material
- STDIO operator boundary copy (no browser command execution)
- Mutation catalog classifications marked heuristic

## Workspace isolation

`resolveCatalogWorkspaceIntegration` matches **exact `connectorKey` only**. Custom workspace keys remain valid for connectors/tools but do not advance catalog journey state.

## UI and accessibility

- Guided setup stepper keyboard navigation (`connector-catalog-setup.test.tsx`)
- RunStep timeline exposes `role="status"` / `role="alert"` guidance for tool failures
- Responsive checks: existing `ux-v2-integrations-browser.integration.test.ts` (not re-run in B6.3D slice unless CI requests Playwright)

## Runtime fixture acceptance

| Tier | Status | Evidence |
|------|--------|----------|
| **A — Offline hermetic** | **PASS** | Console Vitest: `b6-3-native-connector-acceptance.*`, B6.3A/B/C regressions |
| **B — Fixture-backed stack** | **REFERENCE** | `apps/console/test/integration/m12-3-cross-capability.integration.test.ts` scenario 2 (fake MCP + Tool RunStep). Requires disposable Postgres/Valkey; **not executed** in this B6.3D Windows pass — operator may run before merge. |
| **C — Live provider** | **NOT_RUN** | See operator runbook below |

## Provider live acceptance — NOT_RUN

Live GitHub, Shopify, GA4, and npm provider calls were **not** executed by this milestone. Hermetic tests do not prove provider connectivity.

### Operator live runbook (manual)

#### 1. npm (credential-free metadata)

- **Platform:** OSVA 1.1.x web + worker
- **Connector:** published `@osva-ai/connector-npm` version from catalog snapshot
- **Worker:** install pinned package; enable STDIO gate if using STDIO transport
- **Secrets:** none for read-only metadata tools
- **Test input:** Agent task requesting package metadata for a public package
- **Expected:** TOOL RunSteps with MCP tool binding; no raw registry tokens in Console
- **Cleanup:** none required beyond workspace
- **Failure:** inspect Tool RunStep `errorCode`, worker secret resolution, STDIO gate

#### 2. GitHub (read-only repository lookup)

- **Connector:** `@osva-ai/connector-github` per catalog
- **Secrets:** operator-provisioned PAT reference on worker (never in Console UI)
- **Test input:** repository read tool with public repo coordinates
- **Expected:** TOOL RunSteps; import only read-only tools
- **Cleanup:** revoke test PAT if created for acceptance
- **Rate limits:** single-run probe; avoid parallel discovery

#### 3. Shopify + GA4 (dual connector)

- **Connectors:** shopify + ga4 catalog entries
- **Secrets:** separate shop and GA4 credential refs on worker
- **Test input:** Example 21-style multi-tool agent (reference only)
- **Expected:** multiple TOOL RunSteps; no commerce mutations unless explicitly imported
- **Cleanup:** use sandbox stores/properties only
- **NOT claimed:** revenue reconciliation or live acceptance unless operator records evidence

## Catalog provenance verification

- 45 unique connectors, schema v2 snapshot
- `OSVA_CONNECTORS_AUDITED_SHA` matches B6.1 audited revision (see `osva-connectors-catalog.test.ts`)
- Examples 19/20/21 Console routes resolve (`/examples/19-research-report-agent`, etc.)
- No automatic catalog refresh at Console startup

## B6.3D defect fix

- **Connector discover:** guard against non-array `tools` in discover response (`connector-detail-page.tsx`) so malformed BFF payloads surface as empty discovery instead of crashing the page.

## Verification (B6.3D slice)

See final agent report for command output. Root `pnpm format:check` **baseline exception:** 31 pre-existing unrelated paths (unchanged set).

## Known limitations

- RunStep public contract has no correlation id field; Console does not invent correlation metadata
- Live provider acceptance remains operator-owned (Tier C)
- M12.3 stack integration deferred on this machine unless infra is started

## Release and CI readiness

- No new public HTTP API changes in B6.3D
- No database migrations
- No new npm dependencies
- Existing Console CI workflows cover Vitest unit suite; Playwright integrations remain optional heavyweight checks

## Consolidated PR scope

All commits on `feat/b6-3-native-connector-experience`:

1. B6.3A catalog
2. B6.3B guided setup
3. B6.3C agent/diagnostics handoff
4. B6.3D acceptance tests + discover guard + closeout doc
