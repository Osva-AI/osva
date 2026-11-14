# B6.3A — Native Connector Catalog and Discovery

## Capability audit (pre-change)

| Area | State |
| ---- | ----- |
| Workspace connector registry UI | `/tools/connectors`, detail with Streamable HTTP append, discover/import |
| Published package discovery | None in Console |
| Examples catalog | Static `osva-examples` snapshot with browse/detail |
| Integrations nav | Tools vs workspace connectors only |
| Backend catalog API | None (intentionally not added) |

## Build vs reuse

**Selected: (B) version-pinned static catalog snapshot** vendored in Console, mirrored from `osva-connectors/docs/connector-catalog.json` schema v2.

- **Not chosen:** Reusing workspace connector registry API as catalog (wrong resource).
- **Not chosen:** Dedicated backend catalog endpoint (no demonstrated storage need; adds ops surface).
- **Not chosen:** Runtime dependency on osva-connectors monorepo.

Tradeoffs: catalog freshness requires a deliberate snapshot refresh + provenance SHA bump; no live registry drift at runtime.

## Catalog architecture

- Snapshot: `apps/console/src/client/data/osva-connectors-catalog.snapshot.json`
- Provenance: `OSVA_CONNECTORS_AUDITED_SHA` in `osva-connectors-links.ts` (`f6502a2f…`)
- Mapping layer: `osva-connectors-catalog.ts` (display shaping, filters, validation)
- Workspace association: match on immutable `connectorKey` only (never display name)

## UI

- Browse: `/tools/connectors/catalog`
- Detail: `/tools/connectors/catalog/:catalogConnectorId`
- Integrations section nav: Tool registry · **Connector catalog** · Workspace connectors
- Examples catalog updated to `d1cf0d5…` with Examples **20–21**

## Security boundaries

- Catalog is read-only metadata; no secrets, no STDIO command UI, no auto connector creation.
- Workspace status labels stop at imported ToolVersions — **not** “Connected” or live provider health.
- Tool read/mutation lists are **inventory heuristics** from osva-connectors generator.

## Verification (local)

Run on the B6.3A branch:

```text
pnpm --filter @osva/console typecheck
pnpm --filter @osva/console lint
pnpm --filter @osva/console test
pnpm format:check
git diff --check
```

## Known limitations

- All 45 published packages are STDIO in the pinned snapshot; Streamable HTTP setup remains on workspace connector detail only.
- Browse page loads version summaries only for workspace connectors whose keys match catalog keys (bounded N+1).

## B6.3B prerequisites

- Operator-documented, allowlisted worker package install path for STDIO connectors (if product requires in-Console provisioning).
- Optional catalog refresh automation (import script) tied to osva-connectors releases.
- Live integration badges only when explicit acceptance evidence exists per connector.
