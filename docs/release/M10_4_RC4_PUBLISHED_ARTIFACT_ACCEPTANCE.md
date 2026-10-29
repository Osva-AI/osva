# M10.4E-style published-artifact acceptance (RC.4)

Secret-free summary of **R1.1.3 / R1.1.3B** registry-only acceptance for OSVA Community **`1.1.0-rc.4`**. Workstream closeout: [`R1_1_DISTRIBUTION_CLOSEOUT.md`](R1_1_DISTRIBUTION_CLOSEOUT.md). Harness: `scripts/acceptance/r11-registry-only/` (not committed temp consumer dirs).

## Published identities

| Channel | Identity |
| --- | --- |
| **npm** (five packages) | `@osva-ai/*` at **`1.1.0-rc.4`**; dist-tag **`rc`** |
| **PyPI** | **`osva-sdk==1.1.0rc4`** |
| **GHCR** | **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** |
| **OCI index digest** | `sha256:59148d75ab75cafcd8d287e95806a9b50d1e022048502f5c9379381b75d16d2f` |
| **Linux AMD64 manifest** | `sha256:d5ff8e6486944b8939569bc674f28f4496fdf16a846e09e8e0890a6dc3bad0f9` |
| **PyPI wheel SHA-256** | `e1eb68454bcdd3c376919bdb88359ba03481d7407ba9ffc358cda862a4671161` |
| **PyPI sdist SHA-256** | `067379706602848ab46d8b179a6cfbd4393ecaba75651952dab6791fdf2b579a` |
| **Git tag** | **`v1.1.0-rc.4`** → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** |

## Execution environment (R1.1.3B full replay)

| Field | Value |
| --- | --- |
| Date (UTC) | **2026-10-29** (`startedAt` **2026-10-29T17:47:50.863Z**) |
| Host OS | Windows 10 (linux/amd64 Docker); Node **v24.13.1** (consumer probe) |
| Branch | `chore/r1-1-rc4-distribution` |
| Harness git revision | **`e073e2fbeb87b0e820bb3e642be4860d8cdd2e97`** |
| Compose project | **`osva-r11-registry`** |
| Web / MCP ports | **18080** / **13100** |
| Image | `ghcr.io/osva-ai/osva:1.1.0-rc.4` (pull + `--no-build`) |

## Commands

```bash
# Full registry-only matrix (default groups)
OSVA_RC4_REGISTRY_ACCEPTANCE=1 pnpm acceptance:r11-registry

# Focused unfinished journeys (R1.1.3B development)
OSVA_RC4_REGISTRY_ACCEPTANCE=1 OSVA_R11_GROUPS=workflow,mcp,multipart pnpm acceptance:r11-registry

OSVA_SKIP_IMAGE_BUILD=1 OSVA_IMAGE=ghcr.io/osva-ai/osva:1.1.0-rc.4 node scripts/deployment/docker-image-smoke.mjs
node --test scripts/acceptance/r11-registry-only/test/*.test.mjs
pnpm verify:changed
```

PowerShell:

```powershell
$env:OSVA_RC4_REGISTRY_ACCEPTANCE = "1"
pnpm acceptance:r11-registry
```

## Journey results (R1.1.3B full replay)

| # | Journey | Status |
| --- | --- | --- |
| — | npm `@rc` identity (five packages) | **PASS** |
| — | PyPI hash verification | **PASS** |
| 1 | GHCR pull + platform | **PASS** |
| — | Runtime image verify (`verify-runtime-image.mjs`) | **PASS** |
| 2 | Migrations head **`0030_approval_operation_binding_slice`** | **PASS** |
| 3 | Compose bootstrap (API key + workspace) | **PASS** |
| 4 | Deterministic embedding default | **PASS** |
| 5 | MCP startup + Host header security | **PASS** |
| 5b | MCP connector register / discover / import | **PASS** |
| 5c | Agent bind + authorized MCP tool invoke | **NOT RUN** |
| 6 | Published `@osva-ai/cli@1.1.0-rc.4` golden path | **PASS** |
| 7 | Published `@osva-ai/sdk@1.1.0-rc.4` live smoke | **PASS** |
| 8 | Agent deploy + `osva run --wait` | **PASS** |
| 9 | Durable workflow (APPROVAL + WAIT) via published SDK | **PASS** |
| 10 | Artifact upload + download (consumer raw fetch) | **PASS** |
| 10b | SDK vs fetch multipart probe | **PASS** |
| 11 | PyPI `osva-sdk==1.1.0rc4` live smoke | **PASS** |
| 12 | Compose restart persistence | **PASS** |
| 13 | Invalid API key rejected | **PASS** |
| — | Project-scoped cleanup | **PASS** |

Machine-readable evidence: [`R1_1_3B_REGISTRY_EVIDENCE.json`](R1_1_3B_REGISTRY_EVIDENCE.json).

## Non-secret IDs (R1.1.3B full replay)

| Resource | ID |
| --- | --- |
| Workspace | `ddd9a545-113c-4f65-a85e-577848938dcf` |
| AgentVersion | `91383498-9621-47a7-8bdd-7e5ed796c0a9` |
| Run | `b59210aa-b587-4073-ab2a-9ec11dc02ed5` |
| Artifact (journey 10) | `a0f22deb-fde1-4728-bb88-50f0862720e8` |
| Workflow | `51b66267-8e9c-4a66-812d-f46da93239b1` |
| WorkflowRun | `612350c8-2604-433a-839b-b70d707716ef` |
| Connector / ToolVersion | `01670327-7a8d-4e28-b7c1-3309b922f89c` / `0c6fc6ac-7fbc-4564-9a62-b97332366a39` |

## MCP acceptance topology (development-only)

- Fake HTTP MCP from **`@osva/adapters-mcp-client`** test dist (`0.0.0.0` bind, **`allowAnyHost`** so web → `host.docker.internal` is not rejected by fixture Host validation).
- Web reaches fixture at **`http://host.docker.internal:<port>`** with compose **`OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS=true`** when the **`mcp`** group runs (documented operator flag; not a production default).

## SDK multipart investigation (R1.1.3A → 3B)

| Observation | Detail |
| --- | --- |
| R1.1.3A | Consumer smoke **PASS** via raw `fetch` + `FormData`; SDK path reported **`OsvaTransportError`** (`fetch failed`). |
| R1.1.3B isolated + full replay | **`@osva-ai/sdk@1.1.0-rc.4`** `artifacts.create` **PASS** on Node **v24.13.1** alongside raw fetch. |
| Root cause | **Harness timing**, not RC4 SDK defect: probe immediately after heavy workflow+MCP sometimes hit transport-level `fetch failed` for **both** paths before `/ready` stabilization. Harness now waits for `/ready` and probes **fetch before SDK**. |
| RC4 artifacts | **Unchanged** (no republish). |

## Disposition

- **Registry-only RC.4 acceptance executed** for npm, PyPI, GHCR, CLI, SDK, migrations, MCP host + connector discover/import, workflow APPROVAL+WAIT, artifacts, multipart probe, restart, and security smoke.
- **NOT RUN:** journey **5c** (agent binding + authorized MCP tool invocation through a Run) — follow-up registry fixture; no missing public REST for discover/import.
- **Not production certification** — deterministic harness; no real model provider credentials.
