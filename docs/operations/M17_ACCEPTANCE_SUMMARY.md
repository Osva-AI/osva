# M17 Acceptance Summary — Real-world agent adoption and public distribution

Status: **ACCEPTED (scoped)** — published npm/SDK/connector adoption and M17.8 real-world workflow evidence recorded; M17.9 registry publication and clean CLI install verified; M17.9 does **not** replace M17.8 model/tool workflow proof.

**Platform baseline:** **`1.1.1`** · migration head **`0030_approval_operation_binding_slice`**.

Implementation: [`../implementation/M17-REAL-WORLD-AGENT-ADOPTION-AND-PUBLIC-DISTRIBUTION.md`](../implementation/M17-REAL-WORLD-AGENT-ADOPTION-AND-PUBLIC-DISTRIBUTION.md) · Closeout narrative: [`M17_CLOSEOUT_SUMMARY.md`](M17_CLOSEOUT_SUMMARY.md).

## 1. Milestone objective

Close the gap between **in-repo** Community **1.1.1** platform capabilities and **external** agent developer adoption: published Node SDK resources, published npm MCP connector, a catalog real-world example (Example 19), host-based REMOTE_HTTP execution against a live stack, and coordinated public npm **1.1.4** with documented local setup.

## 2. Evidence matrix

| Slice | Scope delivered | PR / merge | Verification | Acceptance | Known limitations |
| --- | --- | --- | --- | --- | --- |
| **M17.2** | SDK `modelProfiles`, `connectors`, `tools` resources | **#75** → **`3270f55`** | `packages/sdk/test/capability-resources.test.ts`; CI on merge | **PASS** | In-repo workspace pins; registry proof via M17.5/M17.9 |
| **M17.2–M17.7** | Published SDK; Example 19 on published SDK; **`@osva-ai/connector-npm@0.1.0`**; Example 19 on published connector | Maintainer npm publish + external example/integration work (no additional osva merge between **#76** and **#77** for this block) | `npm view` / consumer installs; Example 19 operator integration | **PASS** (scoped) | Example 19 lives primarily outside this repo; in-repo fixture is [`examples/canonical-dependency-adoption`](../../examples/canonical-dependency-adoption) |
| **M17.5** | Coordinated npm **1.1.3** release prep | **#76** → **`9a78874`** | `pnpm release:version:check`; pack/smoke scripts; [`M17_5_SDK_RELEASE_READINESS.md`](../release/M17_5_SDK_RELEASE_READINESS.md) | **PASS** | Superseded on registry by **1.1.4** tags |
| **M17.8** | `--remote-http-dev` CLI/Compose profile | **#77** → **`6cdf1d7`** | CLI tests; `scripts/verification/cli-compose-remote-http-dev.test.mjs` | **PASS** (product wiring) | — |
| **M17.8** | Real-world workflow on platform **1.1.1** | Operator acceptance (not gitignored artifact in repo) | MCP **`npm_package_metadata`**, **`npm_downloads`**; OpenAI model call; workflow **PASS**; markdown artifact download; model/tool telemetry | **PASS** | Run id **`a409acad-b3be-47d1-97fc-689158f39b54`** — operator-recorded |
| **M17.9** | Coordinated npm **1.1.4** release prep | **#78** → **`f9fa20e`** | CI **`verify`** **SUCCESS** on merge; `pnpm release:version:check` | **PASS** | — |
| **M17.9** | Registry publication + consumer smoke | Post-merge maintainer | `npm dist-tag` **`latest`** / **`stable-candidate`** → **1.1.4** (all five packages); `node scripts/release/npm-registry-consumer-smoke.mjs` **PASS**; global **`@osva-ai/cli@1.1.4`** install **PASS** | **PASS** | Does **not** rerun M17.8 workflow |
| **M17.9** | Clean install **`osva setup --remote-http-dev`** | Operator workstation | Platform **1.1.1** image; API/Console/MCP/Postgres/Valkey **up**; admin bootstrap + Console password setup; capability secret; **127.0.0.1:8787** | **PASS** (install/smoke) | **`first_agent_run_succeeded`** not verified by installer; no model/tool replay |

## 3. Version coordinates (canonical)

| Surface | Version |
| --- | --- |
| OSVA platform (GHCR / PyPI / Helm / `VERSION`) | **1.1.1** |
| npm `@osva-ai/contracts`, `@osva-ai/runtime-protocol`, `@osva-ai/sdk`, `@osva-ai/connector-sdk`, `@osva-ai/cli` | **1.1.4** (`latest` and `stable-candidate`) |
| npm `@osva-ai/connector-npm` | **0.1.0** |
| Python `osva-sdk` (PyPI) | **1.1.1** |

## 4. M17.9 operator install evidence (registry CLI)

Recorded on operator workstation after **`@osva-ai/cli@1.1.4`** publication (representative checks; not a committed JSON artifact):

- **`osva setup --remote-http-dev`** with bundled platform **`ghcr.io/osva-ai/osva:1.1.1`** — preflight **PASS**, platform services and Console **READY**.
- **`compose.remote-http-dev.yml`** materialized; **`OSVA_RUNTIME_CAPABILITY_SECRET`** present in installation `.env`.
- Worker capability port published on **127.0.0.1:8787** (loopback only).
- Administrator bootstrap **PASS**; Console password setup and sign-in completed by operator.
- **Not executed:** end-to-end agent workflow (that evidence remains **M17.8** §2).

## 5. In-repository merge commits (main)

| Slice | Merge commit |
| --- | --- |
| M17.2 | **`3270f55`** |
| M17.5 | **`9a78874`** |
| M17.8 (CLI) | **`6cdf1d7`** |
| M17.9 | **`f9fa20e`** |

## 6. Deferred scope

- Re-run **`acceptance:m16-registry`** with npm **1.1.4** pins (harness still documents **1.1.2** for **`m16-111`**).
- Commit machine-readable M17.8/M17.9 operator JSON under `artifacts/acceptance/` (optional future harness).
- M15-era PyPI/GHCR/M10.4E distribution gaps unchanged unless separately closed.
- OIDC, Enterprise identity, and post-M17 product roadmap items.

## 7. Closeout checklist

| Item | Status |
| --- | --- |
| Published five-package npm **1.1.4** | **PASS** |
| Published `@osva-ai/connector-npm@0.1.0` | **PASS** (registry) |
| M17.8 real-world model/tool/workflow | **PASS** (operator) |
| M17.9 CLI remote-http-dev install smoke | **PASS** (operator; no workflow replay) |
| Milestone closeout documentation | **PASS** (this slice) |

No **blocking** gaps remain for declaring M17 complete in-repo when this closeout merges.
