# B7.2 — GitHub connector operational acceptance

## Lanes

| Lane | Command | Live GitHub |
| --- | --- | --- |
| **FIXTURE_BACKED_RUNTIME_ACCEPTANCE** | `pnpm acceptance:b7-2:fixture` | **No** (loopback mock) |
| **PUBLISHED_ARTIFACT_LIVE_ACCEPTANCE** | `pnpm acceptance:b7-2:prepare` then `pnpm acceptance:b7-2:published` | **Yes** (read-only) |

## Fixture prerequisites

Build osva-connectors GitHub stdio test fixture, then set:

- `OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY=<path>/stdio-github-fixture.js`, or
- `OSVA_CONNECTORS_ROOT=<osva-connectors checkout>`

## Published live (Windows PowerShell)

```powershell
# Read-only fine-grained PAT — Metadata on Osva-AI/osva only.
$env:B7_2_GITHUB_OPERATOR_PAT = "<operator-supplied-token>"
pnpm acceptance:b7-2:prepare
pnpm acceptance:b7-2:published
```

Imports and runs **only** `github.repository.get`. Never invokes issue create/comment tools.

## Hermetic unit tests

```bash
pnpm acceptance:b7-2:test
```