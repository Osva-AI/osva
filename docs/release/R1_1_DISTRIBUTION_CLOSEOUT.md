# R1.1 â€” RC.4 release distribution closeout

Formal closeout for workstream **R1.1** (OSVA Community **`1.1.0-rc.4`** published-artifact distribution and registry-only consumer acceptance).

This document consolidates evidence. It is **not** external production deployment certification, npm **`latest`** promotion, or GHCR **`:latest`** reassignment.

---

## 1. Release source identity

| Field | Value |
| --- | --- |
| Product version | **`1.1.0-rc.4`** |
| Git tag | **`v1.1.0-rc.4`** |
| Tag target commit | **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** |
| GitHub prerelease | **`2026-10-27T09:54:36Z`** (prerelease) |
| Repository branch (closeout) | **`chore/r1-1-rc4-distribution`** |
| Acceptance harness git revision (R1.1.3B full replay) | **`e073e2fbeb87b0e820bb3e642be4860d8cdd2e97`** |

Provenance is **source revision + registry fingerprints**. In-repo automation does not assert npm provenance attestation or image cosign signatures for RC.4.

---

## 2. Published distribution matrix

| Channel | Identity | Dist-tag / notes | Closeout verification (2026-10-29) |
| --- | --- | --- | --- |
| npm (Ã—5) | `@osva-ai/{contracts,runtime-protocol,sdk,cli,connector-sdk}` **`1.1.0-rc.4`** | **`rc`**; **`latest`** remains **`1.0.0`** | `npm view â€¦@1.1.0-rc.4 version` â†’ **1.1.0-rc.4** (all five) |
| PyPI | **`osva-sdk==1.1.0rc4`** | PEP 440 **`1.1.0rc4`** | PyPI JSON wheel/sdist SHA-256 match inventory |
| GHCR | **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** | Platform **linux/amd64** | `docker buildx imagetools inspect` index digest match |
| Helm (source) | **`deploy/helm/osva`** chart/app **`1.1.0-rc.4`** | Not separately published unless attached to GitHub Release | In-tree only |
| GitHub Release | **`v1.1.0-rc.4`** | Points at tag / **`main`** history | `gh release view v1.1.0-rc.4` |

---

## 3. Registry artifact digests and hashes

| Artifact | Fingerprint |
| --- | --- |
| GHCR OCI **index** | `sha256:59148d75ab75cafcd8d287e95806a9b50d1e022048502f5c9379381b75d16d2f` |
| GHCR **linux/amd64** manifest | `sha256:d5ff8e6486944b8939569bc674f28f4496fdf16a846e09e8e0890a6dc3bad0f9` |
| PyPI wheel **`osva_sdk-1.1.0rc4-py3-none-any.whl`** | `e1eb68454bcdd3c376919bdb88359ba03481d7407ba9ffc358cda862a4671161` |
| PyPI sdist **`osva_sdk-1.1.0rc4.tar.gz`** | `067379706602848ab46d8b179a6cfbd4393ecaba75651952dab6791fdf2b579a` |

---

## 4. Consumer acceptance evidence (R1.1.3B)

**Command:** `OSVA_RC4_REGISTRY_ACCEPTANCE=1 pnpm acceptance:r11-registry`
**Execution (UTC):** **`2026-10-29T17:47:50.863Z`** (full replay, exit **0**)
**Compose project:** **`osva-r11-registry`** (scoped teardown **`down -v`**)
**Runtime image:** published GHCR pull + **`--no-build`** (no workspace-linked consumers, no local OSVA image build in harness)

Machine-readable journey log: [`R1_1_3B_REGISTRY_EVIDENCE.json`](R1_1_3B_REGISTRY_EVIDENCE.json)
Narrative summary: [`M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md)

### Journey disposition

| Area | Journey | Status |
| --- | --- | --- |
| Registry preflight | npm `@rc`, PyPI hashes | **PASS** |
| OCI | GHCR pull, runtime image smoke | **PASS** |
| Stack | migrations **0030**, bootstrap, deterministic embedding | **PASS** |
| MCP host | bundled MCP startup + Host security | **PASS** |
| MCP connectors | register, discover, import | **PASS** |
| MCP tool invoke | agent Run with imported tool | **NOT RUN** |
| npm CLI / SDK | published install + live API | **PASS** |
| Agent | deploy + **`SUCCEEDED`** run | **PASS** |
| Workflow | APPROVAL + WAIT (published SDK) | **PASS** |
| Artifacts | fetch FormData upload/download | **PASS** |
| SDK multipart | `@osva-ai/sdk` `artifacts.create` vs raw fetch | **PASS** (Node **v24.13.1**) |
| Python | **`osva-sdk==1.1.0rc4`** smoke | **PASS** |
| Ops | compose restart persistence | **PASS** |
| Security | invalid API key **401/403** | **PASS** |
| Cleanup | project-scoped Docker volumes | **PASS** |

**Overall:** **PASS with documented NOT RUN** (journey **5c** only). No journeys marked **FAIL** or **PARTIAL** in the full replay.

---

## 5. Security controls and acceptance exceptions

### Production defaults (unchanged)

- **`OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS`** defaults to **`false`** in [`deploy/compose/compose.yml`](../../deploy/compose/compose.yml) (`:-false` interpolation).
- ToolGateway / outbound pinned fetch **denies private/loopback** MCP destinations unless operator opt-in (see `ManagedMcpClient outbound hardening` tests).
- Acceptance does **not** change web/worker production code pathsâ€”only compose env injection for isolated replay.

### Registry-only overrides (harness-only)

| Control | Behavior |
| --- | --- |
| **`OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS=true`** | Set **only** when the acceptance **`mcp`** group runs (`run.mjs` â†’ `composeEnvBase({ allowPrivateMcp: true })`). Enables web container â†’ **`host.docker.internal`** fixture URL. |
| Fake HTTP MCP **`allowAnyHost: true`** | **Test fixture only** (`adapters/mcp-client/src/testing/fake-http-mcp-server.ts`). Skips localhost Host validation so Docker bridge Host headers reach the fixture. Not used by production MCP server. |
| Fake MCP bind **`0.0.0.0`** | Host-gateway topology for registry acceptance; fixture process runs on the developer host, not inside the published image. |

Regression coverage added in R1.1.4:

- Compose default MCP private-network flag wiring test (`deploy-compose-acceptance-wiring.test.mjs`).
- Fake fixture Host header test (`adapters/mcp-client/test/fake-http-mcp-host.test.ts`).

---

## 6. Known limitations

1. **Journey 5c NOT RUN** â€” MCP tool invocation through an agent **Run** after import (registry-only fixture deferred).
2. **Deterministic harness** â€” no real model-provider credentials; embedding default **DETERMINISTIC**.
3. **Not production certification** â€” scoped Docker replay on maintainer Windows + linux/amd64 containers.
4. **External repos** â€” osva-examples / osva-connectors version alignment tracked in [`R1_1_RELEASE_DISTRIBUTION.md`](R1_1_RELEASE_DISTRIBUTION.md) Â§6; no changes in R1.1.
5. **`pnpm verify:ci:clean`** â€” not rerun for R1.1 closeout (release-readiness on tag commit remains authoritative for **`cd38eea`**).
6. **Full registry acceptance** â€” not rerun for R1.1.4 (harness behavior unchanged since R1.1.3B PASS).

---

## 7. Engineering verification (R1.1.4 closeout)

| Check | Result | Notes |
| --- | --- | --- |
| Live registry reconciliation | **PASS** | Tag, npm Ã—5, PyPI hashes, GHCR digest (2026-10-29) |
| `git diff --check` | **PASS** | No conflict markers / whitespace errors |
| Acceptance runner unit tests | **PASS** | `node --test scripts/acceptance/r11-registry-only/test/*.test.mjs` |
| Compose wiring + MCP default test | **PASS** | `deploy-compose-acceptance-wiring.test.mjs` |
| Fake MCP Host fixture test | **PASS** | `adapters/mcp-client/test/fake-http-mcp-host.test.ts` |
| `pnpm verify:changed` | **PASS** | R1.1.4 closeout (**2026-10-29**): ~239s; Turbo **41/46 cached**; includes new MCP Host + compose-config isolation tests |
| Full `pnpm acceptance:r11-registry` | **DEFERRED** | Valid R1.1.3B evidence; no harness change requiring replay |

---

## 8. Commands (closeout)

```bash
git rev-list -n 1 v1.1.0-rc.4
npm view @osva-ai/contracts@1.1.0-rc.4 version   # repeat for five packages
gh release view v1.1.0-rc.4 --json tagName,isPrerelease,publishedAt
docker buildx imagetools inspect ghcr.io/osva-ai/osva:1.1.0-rc.4
# PyPI: https://pypi.org/pypi/osva-sdk/1.1.0rc4/json

node --test scripts/acceptance/r11-registry-only/test/*.test.mjs
node --test scripts/verification/deploy-compose-acceptance-wiring.test.mjs
pnpm --filter @osva/adapters-mcp-client exec vitest run test/fake-http-mcp-host.test.ts
git diff --check
pnpm verify:changed
```

---

## 9. Remaining follow-up (post-R1.1)

| Item | Priority | Owner |
| --- | --- | --- |
| Registry journey **5c** (MCP tool invoke via Run) | Optional acceptance expansion | Platform |
| External ecosystem bumps (osva-adapters / connectors / examples) | Independent repos | Ecosystem |
| Optional `pnpm verify:ci:clean` on merge commit | Maintainer discretion | Engineering |
| Policy decision on npm **`latest`** / GHCR **`:latest`** for 1.1.x | Product | Maintainers |

---

## 10. Final scoped acceptance decision

**Decision:** R1.1 **release distribution closeout â€” ACCEPTED** for OSVA Community **`1.1.0-rc.4`** on npm (**`@rc`**), PyPI, and GHCR, with registry-only consumer acceptance **PASS** for all executed journeys and explicit **NOT RUN** for MCP tool invocation via agent Run.

**Do not:** move npm **`latest`**, PyPI **`latest`**, or GHCR **`:latest`** to RC.4 without maintainer policy.

**Related docs:** [`R1_1_RELEASE_DISTRIBUTION.md`](R1_1_RELEASE_DISTRIBUTION.md), [`RC4_VERIFICATION.md`](RC4_VERIFICATION.md), [`RELEASE_CANDIDATE_INVENTORY.json`](RELEASE_CANDIDATE_INVENTORY.json), [`COMPATIBILITY.md`](COMPATIBILITY.md).
