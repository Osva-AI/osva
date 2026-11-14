# B7.1 — Published npm connector operational acceptance

## Lanes

| Lane | Command | CI |
| --- | --- | --- |
| **FIXTURE_BACKED_RUNTIME_ACCEPTANCE** | `pnpm acceptance:b7-1:fixture` | Suitable when Docker integration is enabled |
| **PUBLISHED_ARTIFACT** (operator) | `pnpm acceptance:b7-1:prepare` then `pnpm acceptance:b7-1:published` | **Never** default CI |

## Published artifact (Windows PowerShell)

```powershell
cd C:\path\to\osva
pnpm acceptance:b7-1:prepare
pnpm acceptance:b7-1:published
```

Prepare performs an isolated `npm install` of `@osva-ai/connector-npm@0.1.1` (peer `@osva-ai/connector-sdk@1.1.4`) and writes `artifacts/acceptance/b7-1/consumer-manifest.json` with the verified `dist/stdio.js` path.

Override entry without reinstall:

```powershell
$env:OSVA_B7_1_NPM_CONNECTOR_STDIO_ENTRY = "D:\...\node_modules\@osva-ai\connector-npm\dist\stdio.js"
pnpm acceptance:b7-1:published
```

## Hermetic unit tests

```bash
pnpm acceptance:b7-1:test
```