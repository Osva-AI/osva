# OSVA Community v1.1.0 — stable release readiness

**Stage:** preparation document (historical prep branch). **Closeout supplement (2026-10-30):** platform **`v1.1.0`** published; corrective npm **`1.1.1`** registry acceptance **PASS**; all five `@osva-ai/*` packages **`latest`** and **`stable-candidate`** → **1.1.1**; **`rc`** → **1.1.0-rc.4**; Python/GHCR **1.1.0** unchanged. Inventory: [`V1_1_STABLE_RELEASE_INVENTORY.json`](V1_1_STABLE_RELEASE_INVENTORY.json); recovery: [`NPM_1_1_1_RECOVERY.md`](NPM_1_1_1_RECOVERY.md).

| Field | Value |
|-------|--------|
| **Stable source revision (prep branch)** | **`661841326a33e3277a33fa06e794c5a5641a249c`** |
| **Branch** | `chore/v1-1-stable-readiness` |
| **Aligned product version (source)** | **`1.1.0`** |
| **Prior registry-verified RC** | **`1.1.0-rc.4`** @ **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** |
| **Assessment (prep)** | **CONDITIONAL GO** — source and packaging ready; blocked on publication and stable registry acceptance |

## 1. Release scope (RC.4 → stable preparation HEAD)

Commits after **`v1.1.0-rc.4`** ( **`cd38eea` → `6618413`** ):

| Commit | Summary |
|--------|---------|
| `6716b83` | M15.1 production adoption baseline docs |
| `c313e1e` | M15.2 Evaluation Studio browser acceptance |
| `f2a80e0` | M15.3 Console operator diagnostics |
| `045122e` | M15.4 unified `acceptance:m15` harness |
| `e073e2f` | M15 closeout documentation |
| `6618413` | R1.1 registry-only acceptance harness + evidence |

**Product delta:** documentation, Console operator UX, evaluation browser coverage, unified adoption acceptance, registry-only consumer replay — **no new Drizzle migrations** beyond RC.4 head **`0030`**.

**Packaging delta vs RC.4 tag:** R1.1 acceptance scripts, compose acceptance wiring, branch-impact verification — all included on stable prep HEAD. No omitted RC.4 release packaging files identified on this branch.

## 2. Version alignment matrix

| Surface | Stable prep value | RC.4 (historical, unchanged evidence) |
|---------|-------------------|----------------------------------------|
| Root `VERSION` | **1.1.0** | 1.1.0-rc.4 |
| `@osva-ai/contracts` (npm) | **1.1.1** (`NPM_DISTRIBUTION_VERSION`; platform **1.1.0**) | 1.1.0-rc.4 |
| `@osva-ai/runtime-protocol` | **1.1.0** | 1.1.0-rc.4 |
| `@osva-ai/sdk` | **1.1.0** | 1.1.0-rc.4 |
| `@osva-ai/cli` | **1.1.0** | 1.1.0-rc.4 |
| `@osva-ai/connector-sdk` | **1.1.0** | 1.1.0-rc.4 |
| `osva-sdk` (pyproject) | **1.1.0** | 1.1.0-rc.4 |
| Helm `version` / `appVersion` | **1.1.0** | 1.1.0-rc.4 |
| Internal monorepo deps | `workspace:*` / `catalog:` (pack smoke validates published graph) | — |

Enforcement: `pnpm release:version:check`.

Inventory: [`V1_1_STABLE_RELEASE_INVENTORY.json`](V1_1_STABLE_RELEASE_INVENTORY.json) (RC.4 record preserved in [`RELEASE_CANDIDATE_INVENTORY.json`](RELEASE_CANDIDATE_INVENTORY.json)).

## 3. Package and build checks

| Check | Prep expectation |
|-------|------------------|
| Five npm packages `pnpm pack` | Run `node scripts/release/npm-pack-smoke.mjs` — tarball manifest audit (see [`NPM_PUBLICATION.md`](NPM_PUBLICATION.md)) |
| Python wheel/sdist | Run `node scripts/release/python-pack-smoke.mjs` — version **1.1.0** |
| Docker image | Build from frozen SHA; **not pushed** |
| Helm metadata | Matches **1.1.0** |
| Secrets in artifacts | `node scripts/release/secrets-scan.mjs` in release-readiness CI |

## 4. Security qualification

Qualification inherits **M14** closeout ([`../operations/M14_7_SECURITY_CLOSEOUT.md`](../operations/M14_7_SECURITY_CLOSEOUT.md)) and **M15** verification summaries. Preserved boundaries:

- ToolGateway authorization; MCP never bypasses ToolGateway
- Workspace isolation on `/v1`
- Human authentication and API key permissions
- Capability-token restrictions
- SSRF / private-network MCP defaults (**off**; acceptance override opt-in only)
- SecretReference handling
- Operation-bound workflow approvals (**0030**)
- Audit redaction patterns from M14

**Dependency vulnerabilities:** no fresh org-wide scan re-run documented in this prep pass; RC.4 remediation (#58) remains latest recorded npm line fix. Treat as **scan not re-run for stable bump** unless release-readiness CI executes on the stable commit.

## 5. Upgrade readiness

| Path | Action |
|------|--------|
| **1.0.0 → 1.1.0** | Migrate through **`0030`**; roll image; reconcile legacy unleased `RUNNING` attempts; see [`../operations/UPGRADE.md`](../operations/UPGRADE.md) |
| **1.1.0-rc.4 → 1.1.0** | Align npm/PyPI/GHCR pins; schema already at **`0030`** if on RC.4 stack |

Supported platforms: see [`COMPATIBILITY.md`](COMPATIBILITY.md) (validated vs declared).

## 6. Acceptance plan

| Mode | Command gate | Status |
|------|--------------|--------|
| **RC.4 historical replay** | `OSVA_RC4_REGISTRY_ACCEPTANCE=1` (default target `rc4`) | **PASS** (recorded R1.1.3B) — does not re-run in prep unless operator executes |
| **Stable 1.1.0 replay** | `OSVA_REGISTRY_ACCEPTANCE_TARGET=stable` + `OSVA_STABLE_REGISTRY_ACCEPTANCE=1` | **NOT RUN** — historical target; npm @1.1.0 defective |
| **Corrective npm 1.1.1 replay** | `OSVA_REGISTRY_ACCEPTANCE_TARGET=stable-npm-111` + `OSVA_STABLE_NPM_111_REGISTRY_ACCEPTANCE=1` | **PASS** — [`V1_1_0_NPM_1_1_1_REGISTRY_EVIDENCE.json`](V1_1_0_NPM_1_1_1_REGISTRY_EVIDENCE.json) (19 PASS, 0 FAIL, 1 NOT_RUN) |
| **Journey 5c** (MCP tool invoke via agent run) | — | **NOT RUN** (explicit deferral) |
| **In-repo M15** | `pnpm acceptance:m15` | Exercises source-linked adoption; not a substitute for stable registry replay |

Harness: [`scripts/acceptance/r11-registry-only/`](../../scripts/acceptance/r11-registry-only/README.md).

## 7. Publication order (document only — do not execute here)

1. Merge stable preparation PR.
2. Verify **release-readiness** CI on final source.
3. Freeze release SHA; create **`v1.1.0`** annotated tag (maintainer).
4. Build artifacts from tag worktree.
5. Validate packed versions and dependency graph.
6. Publish npm five packages in dependency order (`contracts` → `runtime-protocol` → `sdk` → `connector-sdk` → `cli`).
7. Verify npm install and metadata.
8. Publish **PyPI** `osva-sdk==1.1.0`; record wheel/sdist SHA-256.
9. Publish **GHCR** `ghcr.io/osva-ai/osva:1.1.0`; record OCI index digest (**linux/amd64**).
10. Update `STABLE_110_TARGET` in `lib/targets.mjs` with digests; set `registryArtifactsReady: true`.
11. Run stable registry-only acceptance.
12. GitHub Release + evidence JSON (new stable evidence file; do not mutate RC.4 evidence).
13. Promote **`latest`** / GHCR aliases only per approved stable policy (**note:** some registries auto-update `latest` on publish — document before push).

## 8. Mandatory release gates

- [ ] `pnpm release:version:check` on stable bump commit
- [ ] `pnpm db:migrations:verify`
- [ ] release-readiness workflow (verify-core, packages, oci-compose-helm, kind) on **tag SHA**
- [ ] npm pack smoke + Python pack smoke
- [ ] Secrets scan clean
- [ ] Stable registry-only acceptance **after** publication
- [ ] Maintainer sign-off on CHANGELOG / COMPATIBILITY / UPGRADE

## 9. Known limitations

- Journey **5c** not implemented in registry harness.
- RC.4 acceptance does not certify stable binaries.
- npm **`latest`** and **`stable-candidate`** resolve to corrective **1.1.1** (platform **1.1.0** on PyPI/GHCR). GHCR **`:latest`** alias promotion remains separate policy.
- External repos (osva-examples, osva-connectors) may lag aligned versions — follow-up outside this release.

## 10. Remaining blockers

**Superseded for npm (2026-10-30):** git tag **`v1.1.0`**, stable PyPI/GHCR **1.1.0**, corrective npm **1.1.1** acceptance, and npm **`latest`** promotion — see closeout supplement above.

Still open:

1. **GitHub Release** page and release assets not verified (inventory pending gate).
2. **GHCR `:latest`** (and related aliases) not promoted in npm **1.1.1** closeout.
3. **Journey 5c** MCP tool invoke not implemented in registry harness (**NOT_RUN**).

## 11. Release approval checklist

- [ ] Product owner accepts M11–M15 scope for GA
- [ ] Security maintainer accepts M14 qualification carry-forward
- [ ] Operator docs reviewed (UPGRADE, RUNBOOK, COMPATIBILITY)
- [ ] Publication credentials and registry write access confirmed
- [ ] Rollback plan documented (forward-only schema)

## 12. Prep-stage disclaimer

This file **primarily records** stable **1.1.0** preparation on branch `chore/v1-1-stable-readiness`. Published stable and corrective npm outcomes are recorded in [`V1_1_STABLE_RELEASE_INVENTORY.json`](V1_1_STABLE_RELEASE_INVENTORY.json) and [`NPM_1_1_1_RECOVERY.md`](NPM_1_1_1_RECOVERY.md).
