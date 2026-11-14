# B7.3 — Shopify + GA4 dual-connector operational acceptance

## Lanes

| Lane | Command | Live providers |
| --- | --- | --- |
| **FIXTURE_BACKED_RUNTIME_ACCEPTANCE** | `pnpm acceptance:b7-3:fixture` | **No** (loopback mocks) |
| **PUBLISHED_ARTIFACT_LIVE_ACCEPTANCE** | `pnpm acceptance:b7-3:prepare` then `pnpm acceptance:b7-3:published` | **Yes** (read-only) |

## Fixture prerequisites

1. Built osva-connectors `@osva-ai/connector-shopify` and `@osva-ai/connector-ga4` (`dist/`).
2. Built osva `@osva/tool-gateway` test stdio fixtures (`.build/stdio-*-fixture.js`).
3. `OSVA_CONNECTORS_ROOT` pointing at the osva-connectors checkout (auto-detected as sibling when present).

## Published live (Windows PowerShell)

```powershell
# Sandbox shop + read-only Admin API token (shopify.shop.get only).
$env:B7_3_SHOPIFY_OPERATOR_ACCESS_TOKEN = "<operator-supplied-shpat>"
$env:B7_3_SHOPIFY_OPERATOR_SHOP = "your-sandbox.myshopify.com"

# GA4 service account JSON path (never commit) + numeric property ID.
$env:B7_3_GA4_OPERATOR_CREDENTIALS_PATH = "C:\path\to\ga4-sa.json"
$env:B7_3_GA4_OPERATOR_PROPERTY_ID = "123456789"

pnpm acceptance:b7-3:prepare
pnpm acceptance:b7-3:published
```

One Run imports **only** `shopify.shop.get` and `ga4.property.get` (Example 21-style dual read agent). Output includes a non-reconciliation attribution note.

## Hermetic unit tests

```bash
pnpm acceptance:b7-3:test
```