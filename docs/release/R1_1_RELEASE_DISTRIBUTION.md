# R1.1 — Release distribution and published-artifact acceptance (RC.4)

Workstream **R1.1** prepares and verifies **OSVA Community `1.1.0-rc.4`** distribution through **PyPI** and **GHCR**, and designs **registry-only** acceptance after publication.

**Scope:** release engineering only. **No RC.4 source changes.** **No publication** is performed by this document.

**Immutable release identity**

| Field | Value |
| --- | --- |
| Version | `1.1.0-rc.4` |
| Git annotated tag | `v1.1.0-rc.4` → commit **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** |
| Python (PEP 440) | `1.1.0rc4` (`pip install osva-sdk==1.1.0rc4`) |
| OCI tag | `ghcr.io/osva-ai/osva:1.1.0-rc.4` |
| Drizzle migration head | `0030_approval_operation_binding_slice` |
| M15 development HEAD (post-closeout) | **`e073e2fbeb87b0e820bb3e642be4860d8cdd2e97`** (M15 fully merged; **not** the RC.4 tag target) |

Related: [`RC4_VERIFICATION.md`](RC4_VERIFICATION.md), [`RELEASE_CANDIDATE_INVENTORY.json`](RELEASE_CANDIDATE_INVENTORY.json), [`M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md).

---

## 1. Distribution state matrix (authoritative reconciliation)

Reconciliation: **2026-10-28** (R1.1 audit). Methods: local `git`, `npm view`, PyPI JSON API, GitHub `gh` (release + GHCR package versions + Actions), prior M15.5 records cross-checked.

| Channel | Version / identity | Published | Source revision | Verification method | Outstanding blockers |
| --- | --- | --- | --- | --- | --- |
| Git tag | `v1.1.0-rc.4` | **Yes** | `cd38eea…` | `git rev-list -n 1 v1.1.0-rc.4`; annotated tag object → same SHA | None |
| GitHub prerelease | `v1.1.0-rc.4` | **Yes** | Tag → `cd38eea…` | `gh release view v1.1.0-rc.4` (`publishedAt` **2026-10-27T09:54:36Z**, prerelease) | Release **assets[] empty** (no Helm tgz attached; unlike RC.2 record) |
| npm `@osva-ai/contracts` `@rc` | `1.1.0-rc.4` | **Yes** | Published tarball (registry) | `npm view @osva-ai/contracts@rc version` | None for npm line |
| npm `@osva-ai/runtime-protocol` `@rc` | `1.1.0-rc.4` | **Yes** | Registry | `npm view …@rc` | None |
| npm `@osva-ai/sdk` `@rc` | `1.1.0-rc.4` | **Yes** | Registry | `npm view …@rc` | None |
| npm `@osva-ai/cli` `@rc` | `1.1.0-rc.4` | **Yes** | Registry | `npm view …@rc` | None |
| npm `@osva-ai/connector-sdk` `@rc` | `1.1.0-rc.4` | **Yes** | Registry | `npm view …@rc` | None |
| npm `latest` (all five) | `1.0.0` | **Yes** (stable) | GA line | `npm view @osva-ai/contracts dist-tags` | **Do not move `latest` without policy** |
| PyPI `osva-sdk` | **`1.1.0rc4`** | **Yes** | Registry wheel/sdist | PyPI JSON `1.1.0rc4` file digests match R1.1 local build fingerprints (see §2.5 / inventory) | None |
| GHCR `ghcr.io/osva-ai/osva` | **`1.1.0-rc.4`** | **Yes** | OCI index digest | `docker buildx imagetools inspect ghcr.io/osva-ai/osva:1.1.0-rc.4` → **`sha256:59148d75…`**; **linux/amd64** | None |
| Helm chart | `1.1.0-rc.4` in-tree | **Source only** | `cd38eea…` tree | `deploy/helm/osva/Chart.yaml` | Not a separate registry artifact unless attached to GitHub Release |
| GitHub **Release readiness** | CI on `cd38eea` | **Yes** (evidence) | `cd38eea…` | Run **`40479668476`** — all jobs **success** | None (historical; does not replace post-publish smoke) |
| M10.4E registry-only acceptance | RC.4 replay | **Executed (R1.1.3B)** | Published artifacts | [`M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md), [`R1_1_3B_REGISTRY_EVIDENCE.json`](R1_1_3B_REGISTRY_EVIDENCE.json); `pnpm acceptance:r11-registry` | Journey **5c** (MCP tool invoke via Run) **NOT RUN** |

**RC.4 registry publication (PyPI + GHCR) is complete.** **M10.4E-equivalent acceptance ran** through **R1.1.3B** (**2026-10-29** full replay **PASS**; residual **NOT RUN** journey **5c** only).

---

## 2. Immutable artifact provenance

### 2.1 Tag and CI

- Annotated tag **`v1.1.0-rc.4`** resolves to **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** (`fix(security): remediate RC4 dependency vulnerabilities (#58)`).
- **Release readiness** workflow on push to `main` at that commit: run **`40479668476`**, `headSha` = **`cd38eea…`**, conclusion **success** (`verify-core`, `packages`, `oci-compose-helm`, `kind`).

### 2.2 Build checkout policy

PyPI and GHCR artifacts **must** be built from the tag commit, not from post-M15 `main`.

**Recommended maintainer checkout (matches R1.1 local verification):**

```bash
git fetch origin tag v1.1.0-rc.4
git worktree add ../osva-rc4-build v1.1.0-rc.4
cd ../osva-rc4-build
git rev-parse HEAD   # must print cd38eea46b8ee44bb099ccf307818cfcd348f50b
```

Alternatively: GitHub Actions `workflow_dispatch` job with `actions/checkout@v4` and `ref: v1.1.0-rc.4` (no in-repo publish workflow exists today).

### 2.3 Version alignment at tag

At **`cd38eea`**: root **`VERSION`**, five public npm packages, `sdks/python/pyproject.toml`, and Helm `version` / `appVersion` are **`1.1.0-rc.4`**. Enforced by `pnpm release:version:check` / `scripts/release/version-consistency.mjs`.

### 2.4 Publication automation gap

- **No** `.github/workflows` job performs `npm publish`, `twine upload`, or `docker push` to GHCR (only **Release readiness** verification).
- npm RC.4 publication was **manual** (completed M15.5).
- PyPI and GHCR remain **manual operator** steps (checklists below).

### 2.5 Local pre-publication build evidence (R1.1)

Built from worktree at **`cd38eea`** (Windows operator environment, **2026-10-28**). These digests are **local build fingerprints**, not published registry digests.

| Artifact | SHA-256 |
| --- | --- |
| `osva_sdk-1.1.0rc4-py3-none-any.whl` | `e1eb68454bcdd3c376919bdb88359ba03481d7407ba9ffc358cda862a4671161` |
| `osva_sdk-1.1.0rc4.tar.gz` (sdist) | `067379706602848ab46d8b179a6cfbd4393ecaba75651952dab6791fdf2b579a` |
| OCI `osva:1.1.0-rc.4` (local pre-push) | `sha256:ce7f09bc3915184eaa24c8231dabfbac8ad217ea30052a4039425b2623d0aea8` |
| OCI **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** (published index) | `sha256:59148d75ab75cafcd8d287e95806a9b50d1e022048502f5c9379381b75d16d2f` |
| OCI **linux/amd64** manifest | `sha256:d5ff8e6486944b8939569bc674f28f4496fdf16a846e09e8e0890a6dc3bad0f9` |
| PyPI wheel **`osva_sdk-1.1.0rc4-py3-none-any.whl`** (published) | `e1eb68454bcdd3c376919bdb88359ba03481d7407ba9ffc358cda862a4671161` |
| PyPI sdist **`osva_sdk-1.1.0rc4.tar.gz`** (published) | `067379706602848ab46d8b179a6cfbd4393ecaba75651952dab6791fdf2b579a` |

**OCI labels:** the root `Dockerfile` does not set `org.opencontainers.image.revision` or version labels. Published provenance uses **tag + recorded GHCR/PyPI digests** (above).

---

## 3. PyPI RC.4 publication readiness

### 3.1 Package audit

| Check | Result (R1.1) |
| --- | --- |
| Name | `osva-sdk` |
| Version in `pyproject.toml` at tag | `1.1.0-rc.4` → wheel/sdist **`1.1.0rc4`** |
| License | Apache-2.0 |
| Runtime dependency | `httpx>=0.27` |
| Public API | `from osva import OSVAClient` |
| Build backend | hatchling |

### 3.2 Build and verify (from tag worktree)

```bash
cd sdks/python
python -m pip install --upgrade pip build twine
python -m build
python -m twine check dist/*
node ../../scripts/release/python-pack-smoke.mjs   # from repo root; installs wheel in clean venv
```

**R1.1 results:** `twine check` **PASSED** (wheel + sdist); `python-pack-smoke.mjs` **PASSED** (import + version assertion).

### 3.3 Preconditions

1. Tag worktree at **`v1.1.0-rc.4`** / **`cd38eea…`**.
2. `pnpm release:version:check` **PASS** (optional cross-check).
3. Release readiness already **green** on **`cd38eea`** (historical).
4. PyPI project **`osva-sdk`** maintainer role or **trusted publishing** (OIDC) configured for the publishing identity — **not verified in-repo** (operator confirms in PyPI project settings).

### 3.4 Publication checklist A — PyPI (operator; **irreversible** version upload)

| Step | Action |
| --- | --- |
| 1 | Confirm PyPI has **no** existing `1.1.0rc4` release (`curl` JSON index or PyPI UI). |
| 2 | Build sdist + wheel from **tag worktree** only (§3.2). |
| 3 | Record SHA-256 of `dist/*` in release notes / inventory. |
| 4 | Upload: `python -m twine upload dist/osva_sdk-1.1.0rc4*` (use project-configured repository URL; **do not** commit credentials). |
| 5 | Post-publish: `pip install osva-sdk==1.1.0rc4` in a **fresh venv**; `python -c "from osva import OSVAClient; import importlib.metadata as m; assert m.version('osva-sdk') in ('1.1.0-rc.4','1.1.0rc4')"` |
| 6 | **Do not** change PyPI **`latest`** (remains **`1.0.0`** per policy). |

**Irreversible:** uploading **`1.1.0rc4`** to PyPI; yanking is policy-heavy and breaks pins — treat upload as final.

**Rollback limitations:** PyPI does not allow re-uploading the same version; fix forward requires a **new** version bump.

---

## 4. GHCR RC.4 publication readiness

### 4.1 Image audit

| Check | Result (R1.1) |
| --- | --- |
| Dockerfile | Multi-stage Node 24 bookworm; production prune; non-root `node` user |
| Entrypoint | `deploy/docker/entrypoint.sh`; `CMD ["web"]` |
| Trusted runtime / artifacts | `OSVA_TRUSTED_RUNTIME_ROOT`, `OSVA_ARTIFACT_FILESYSTEM_ROOT` |
| Dev deps in runtime image | Absent (`verify-runtime-image.mjs` **PASS**) |
| Migrations | Via compose/worker/web entrypoints (same as release-readiness compose acceptance) |

### 4.2 Build and verify (from tag worktree)

```bash
export VERSION="$(tr -d ' \n\r' < VERSION)"
export OSVA_IMAGE="osva:${VERSION}"
docker build -t "$OSVA_IMAGE" .
node scripts/deployment/verify-runtime-image.mjs
node scripts/deployment/docker-image-smoke.mjs
# Optional full stack (Linux): OSVA_DEPLOY_ACCEPTANCE=true node scripts/deployment/deploy-compose-acceptance.mjs
```

**R1.1 results:** `verify-runtime-image.mjs` **PASS**; `docker-image-smoke.mjs` **PASS** (includes migration/web smoke).

### 4.3 Publication checklist B — GHCR (operator)

| Step | Action |
| --- | --- |
| 1 | Build from **tag worktree** only; record local manifest digest. |
| 2 | Tag: `docker tag osva:1.1.0-rc.4 ghcr.io/osva-ai/osva:1.1.0-rc.4` |
| 3 | Authenticate: `echo "$GITHUB_TOKEN" \| docker login ghcr.io -u USERNAME --password-stdin` with **`packages:write`** (or `GITHUB_TOKEN` in Actions with `permissions: packages: write`). |
| 4 | Push: `docker push ghcr.io/osva-ai/osva:1.1.0-rc.4` |
| 5 | **Do not** push to `:latest` or stable aliases without maintainer policy. |
| 6 | **Do not** overwrite **`1.1.0-rc.2`** or other historical tags. |
| 7 | Post-publish: `docker pull ghcr.io/osva-ai/osva:1.1.0-rc.4`; record index digest from `docker buildx imagetools inspect` or GHCR UI. |

**Irreversible / sensitive:** pushing a tag may be overwritten if the same tag is pushed again — **avoid tag reuse** after consumers pin digests.

**Platforms:** R1.1 local build is **single-platform** (operator Docker default). If RC.2 published multi-arch, confirm org policy; add `docker buildx build --platform linux/amd64,linux/arm64` if required (match RC.2 manifest policy from M10.4 record).

---

## 5. Registry-only acceptance design (post-publication)

Reuse the **M10.4E pattern** ([`M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md)) without duplicating the full monorepo harness. Execute in an **isolated directory** with **no** `workspace:*` / `pnpm link` / `-e ./sdks/python`.

Suggested project name: **`osva-r11-registry`** (temporary; not committed).

### 5.1 Environment rules

- Install **only** from npm (`@rc` or exact `@1.1.0-rc.4`), PyPI (`==1.1.0rc4`), and GHCR (`:1.1.0-rc.4`).
- Compose: `deploy/compose/compose.yml` with `OSVA_IMAGE=ghcr.io/osva-ai/osva:1.1.0-rc.4` and **`docker compose up -d --no-build --wait`** (no `build:` context from osva source).
- Fresh Postgres volume; migration head **`0030_approval_operation_binding_slice`**.

### 5.2 Journey coverage (12 required)

| # | Journey | Method |
| --- | --- | --- |
| 1 | Install from published OCI | Pull GHCR tag; compose up |
| 2 | Apply migrations | `db:migrations:status` / integrity via web or documented CLI in container |
| 3 | Bootstrap human identity | Compose **`bootstrap` profile once** (same as M10.4E) |
| 4 | Configure model provider | Fake/deterministic provider env (M12.3 pattern) or operator model connection |
| 5 | npm CLI + SDK `@rc` | `npm i -g @osva-ai/cli@1.1.0-rc.4` (or npx); `@osva-ai/sdk@1.1.0-rc.4` |
| 6 | Simple agent | `osva init` → build → validate → deploy → `osva run --wait` |
| 7 | Durable workflow | Workflow create/run via SDK or REST (canonical workflow fixture) |
| 8 | REST + SDK compatibility | Live smoke against `/v1` (SDK + CLI) |
| 9 | Artifact download | Create run artifact; download via API |
| 10 | Python SDK RC.4 | `pip install osva-sdk==1.1.0rc4`; list agents smoke |
| 11 | Container restart | `docker compose down` (no `-v`); up again; data retained |
| 12 | Security defaults | No embedded secrets in image; private-network MCP/runtime still denied without opt-in |

### 5.3 Reuse vs new automation

| Reuse | Notes |
| --- | --- |
| `scripts/deployment/deploy-compose-acceptance.mjs` | **Source-build** path by default; for registry-only, set `OSVA_IMAGE` to GHCR and use compose **without** `--build` |
| `scripts/acceptance/m15-4/lib/rc4-registry-check.mjs` | npm `@rc` version check (already in M15.4 optional step) |
| M10.4E operator journal format | Record workspace/agent/run IDs without secrets |

**Implemented (R1.1.3 / R1.1.3B):** `scripts/acceptance/r11-registry-only/run.mjs` — `pnpm acceptance:r11-registry` (requires `OSVA_RC4_REGISTRY_ACCEPTANCE=1`). Group filter: `OSVA_R11_GROUPS=workflow,mcp,multipart` (or `--group=`).

### 5.4 Acceptance completion criteria

- Registry-only journeys **PASS** where executed; **NOT RUN** reported accurately (no false passes).
- Evidence recorded in [`M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md) and [`R1_1_3B_REGISTRY_EVIDENCE.json`](R1_1_3B_REGISTRY_EVIDENCE.json) (**2026-10-29** full replay).
- **Outstanding:** journey **5c** (agent binding + authorized MCP tool invocation through a Run) — discover/import **5b** and workflow **9** are **PASS** via published SDK/REST only.

---

## 6. External ecosystem compatibility (read-only)

| Repository | Declared OSVA line | R1.1 assessment |
| --- | --- | --- |
| **osva-adapters** | `@osva-ai/contracts@1.1.0-rc.4`; reference tag `v1.1.0-rc.4` | **Aligned** with RC.4 npm. A1.4 accepts local image build when GHCR `1.1.0-rc.4` missing — **blocked on GHCR publish** for registry-only adapter acceptance. Fix stale tag SHA in their COMPATIBILITY (`c70a0c7` is tag object, not commit — should cite **`cd38eea`**). |
| **osva-examples** | **OSS `1.0.0`** only | **Not RC.4**. Follow-up: optional RC.4 track or bump `COMPATIBILITY.md` + deps to `@1.1.0-rc.4` and run repo `verify`. |
| **osva-connectors** | **`@osva-ai/connector-sdk@1.1.0-rc.2`** (transitive contracts RC.2) | **Behind RC.4**. Compatible for ToolGateway wire protocol in most cases; bump to **`connector-sdk@1.1.0-rc.4`** for Zod 4.6.7 / collection bounds parity with core. Connector npm packages largely **unpublished** (tarball acceptance). |

**Independent follow-up tasks (external repos, no changes made in R1.1):**

1. **osva-adapters:** Update COMPATIBILITY commit SHA to **`cd38eea…`**; re-run `pnpm verify:a1-4` against **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** after GHCR publish.
2. **osva-connectors:** Bump `connector-sdk` / lockfile to **`1.1.0-rc.4`**; run connector CI; update `docs/compatibility.md`.
3. **osva-examples:** Either document intentional **1.0.0** stable scope or add RC.4 verification job consuming npm `@rc`.

---

## 7. Engineering verification (R1.1 execution log)

Commands run for this workstream (**2026-10-28**). **NOT RUN** is not reported as PASS.

| Command | Context | Result |
| --- | --- | --- |
| `git rev-list -n 1 v1.1.0-rc.4` | Main repo | **PASS** → `cd38eea…` |
| `npm view @osva-ai/*@rc version` (×5) | Registry | **PASS** → `1.1.0-rc.4` |
| PyPI JSON `osva-sdk` **`1.1.0rc4`** | Registry | **PASS** (wheel + sdist SHA-256 verified) |
| GHCR **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** | Registry | **PASS** (index digest **`59148d75…`**, **linux/amd64**) |
| `gh release view v1.1.0-rc.4` | GitHub | **PASS** (prerelease published) |
| `gh run view 40479668476` | Actions | **PASS** (release readiness on `cd38eea`) |
| `pnpm release:version:check` | Main repo | **PASS** |
| `node --test scripts/release/release-readiness-version.test.mjs` | Main repo | **PASS** |
| `git diff --check` | Main repo | **PASS** |
| `pnpm release:licenses` | Main repo | **PASS** (inventory regenerated) |
| `node scripts/release/npm-pack-smoke.mjs` | Tag worktree `cd38eea` | **PASS** |
| `node scripts/release/python-pack-smoke.mjs` | Tag worktree `cd38eea` | **PASS** |
| `python -m twine check dist/*` | Tag worktree `cd38eea` | **PASS** |
| `docker build` + `verify-runtime-image.mjs` + `docker-image-smoke.mjs` | Tag worktree `cd38eea` | **PASS** |
| `pnpm verify:ci:clean` | — | **NOT RUN** (source unchanged vs tag; release readiness already on tag) |
| `deploy-compose-acceptance.mjs` full stack | — | **NOT RUN** in R1.1 (docker-image-smoke covers subset; full compose optional on Linux maintainer host) |
| `OSVA_RC4_REGISTRY_ACCEPTANCE=1 pnpm acceptance:r11-registry` | Windows + Docker **2026-10-29** (R1.1.3B) | **PASS** (full matrix; journey **5c NOT RUN**) |
| `OSVA_R11_GROUPS=workflow,mcp,multipart pnpm acceptance:r11-registry` | R1.1.3B focused | **PASS** (workflow **9**, MCP **5b**, multipart **10b**) |
| `OSVA_SKIP_IMAGE_BUILD=1 OSVA_IMAGE=ghcr.io/osva-ai/osva:1.1.0-rc.4 node scripts/deployment/docker-image-smoke.mjs` | Published OCI | **PASS** |
| `pnpm verify:changed` | R1.1.3 harness commit | **PASS** (format + changed-scope gates) |

---

## 8. Security considerations

- **Secrets:** `scripts/release/secrets-scan.mjs` in release-readiness; Python wheel contains only `src/osva` package tree (verify with `python -m build` + inspect).
- **Credentials:** No PyPI/GHCR tokens in repository. Publication uses operator secrets or GitHub OIDC (if configured outside this repo).
- **Container:** Runtime image runs as **`node`**; devDependencies stripped; no `typescript`/`vitest` in runtime layer (verified).
- **Dist-tags:** Do not move npm/PyPI **`latest`** off **`1.0.0`** without explicit policy.
- **GHCR aliases:** Do not move **`:latest`** to RC.4.

---

## 9. Publication approvals required

| Approval | Owner |
| --- | --- |
| Explicit maintainer authorization to upload **`osva-sdk==1.1.0rc4`** | PyPI project maintainers |
| Explicit authorization to push **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** | Org **`packages:write`** |
| Record post-publish digests in inventory + acceptance doc | Release engineer |
| Run registry-only acceptance (§5) before claiming RC.4 “distribution complete” | Release engineer |

---

## 10. Outstanding blockers (post-publication)

1. **Registry-only MCP tool invocation (journey 5c)** — discover/import **PASS**; agent Run with imported tool **NOT RUN**.
2. **No in-repo automated publish workflow** — PyPI/GHCR remain manual operator procedures (§3.4, §4.3).
3. **GitHub Release has no attached assets** — optional Helm tgz attachment is a separate maintainer decision.
4. **OCI image revision labels not embedded** — provenance relies on tag + digest record at push time.
5. **External ecosystem** — osva-examples still on **1.0.0** line; osva-connectors on **RC.2** connector-sdk (§6).

---

## 11. Recommendation

**RC.4 PyPI and GHCR publication are verified** (digests in §2.5). **R1.1.3B registry-only acceptance executed** with evidence in [`M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_RC4_PUBLISHED_ARTIFACT_ACCEPTANCE.md) and [`R1_1_3B_REGISTRY_EVIDENCE.json`](R1_1_3B_REGISTRY_EVIDENCE.json).

**Recommend:** treat RC.4 **published-artifact distribution as complete** for npm/PyPI/GHCR consumer install paths and documented registry-only journeys (including workflow **9** and MCP discover/import **5b**). Residual optional gap: **journey 5c** (MCP tool invoke via agent Run). This is **not** external production certification.

Formal closeout record: [`R1_1_DISTRIBUTION_CLOSEOUT.md`](R1_1_DISTRIBUTION_CLOSEOUT.md) (**R1.1.4**, **2026-10-29**).

**Do not** move npm/PyPI **`latest`** or GHCR **`:latest`** to RC.4 without maintainer policy.
