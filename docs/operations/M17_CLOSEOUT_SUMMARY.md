# M17 Closeout Summary — Real-world agent adoption and public distribution

Branch: **`docs/m17-closeout`** (from **`f9fa20e`** M17.9 merge)

Acceptance record: [`M17_ACCEPTANCE_SUMMARY.md`](M17_ACCEPTANCE_SUMMARY.md)

## 1. Delivered capabilities

| Area | Delivered |
| --- | --- |
| **SDK (M17.2)** | Public `@osva-ai/sdk` resources: `modelProfiles`, `connectors`, `tools` (PR **#75**) |
| **Distribution (M17.2–M17.7)** | npm SDK **1.1.3** then **1.1.4** lines; **`@osva-ai/connector-npm@0.1.0`**; Example 19 on published SDK + connector (operator/registry evidence) |
| **REMOTE_HTTP dev setup (M17.8)** | `osva setup --remote-http-dev`, overlay Compose, capability secret, loopback bridge (PR **#77**) |
| **Real-world acceptance (M17.8)** | Platform **1.1.1** workflow with npm MCP tools, OpenAI model, artifact + observability — run **`a409acad-b3be-47d1-97fc-689158f39b54`** |
| **npm 1.1.4 (M17.9)** | Coordinated five-package release, registry consumer smoke, **`latest`** / **`stable-candidate`** promotion (PR **#78** + operator publish) |
| **Closeout** | Implementation spec, acceptance/closeout summaries, roadmap/tracker, release readiness status reconciliation |

## 2. Architecture impact

**Minimal and bounded:**

- **M17.2** adds SDK HTTP client surfaces only; control-plane contracts already existed in `@osva-ai/contracts`.
- **M17.8/M17.9** change CLI installation templates and opt-in Compose overlay; default **`osva setup`** without **`--remote-http-dev`** preserves prior M16 behavior (no capability port publication).
- Run lifecycle, ToolGateway, ModelGateway, PostgreSQL authority, and migration head **`0030`** unchanged.

## 3. Version distinction (required reading)

| Surface | Version |
| --- | --- |
| OSVA platform | **1.1.1** |
| Five npm `@osva-ai/*` platform packages | **1.1.4** |
| npm MCP connector | **`@osva-ai/connector-npm@0.1.0`** |
| Python SDK (PyPI) | **1.1.1** |

## 4. Verification performed (closeout)

| Check | Result |
| --- | --- |
| `pnpm release:version:check` | **PASS** (platform **1.1.1**, npm **1.1.4**) |
| `npm view @osva-ai/*@1.1.4` / dist-tags **`latest`**, **`stable-candidate`** | **PASS** (all five packages) |
| `npm view @osva-ai/connector-npm@0.1.0` | **PASS** |
| PR **#78** CI **`verify`** | **SUCCESS** on **`f9fa20e`** |
| Closeout doc formatting + `git diff --check` | **PASS** (this commit) |
| `pnpm verify:ci:clean` | **NOT RUN** (documentation-only closeout) |

Prior slice verification: M17.2 SDK tests; M17.8 CLI/Compose tests; M17.9 release prep documented in [`../release/M17_9_NPM_RELEASE_READINESS.md`](../release/M17_9_NPM_RELEASE_READINESS.md).

## 5. Evidence separation (M17.8 vs M17.9)

- **M17.8** owns the full **model + MCP tool + workflow + artifact + observability** acceptance on platform **1.1.1** (run id above).
- **M17.9** owns **registry publication**, **npm-registry-consumer-smoke**, and **clean CLI install** including **`osva setup --remote-http-dev`** through platform/Console/MCP/data-plane **READY** and administrator bootstrap.
- M17.9 **does not** claim an independent rerun of the M17.8 workflow.

## 6. Deferred scope

- Update **`m16-111`** registry harness pins from npm **1.1.2** to **1.1.4** (maintenance follow-up).
- Machine-readable acceptance JSON for M17.8/M17.9 in `artifacts/acceptance/`.
- M15 distribution deferrals (PyPI/GHCR matrix refresh, M10.4E replay) unless separately closed.
- Installer **`first_agent_run_succeeded`** proof on registry-only installs.

## 7. Related documentation

| Document | Role |
| --- | --- |
| [`M17_ACCEPTANCE_SUMMARY.md`](M17_ACCEPTANCE_SUMMARY.md) | Evidence matrix |
| [`../implementation/M17-REAL-WORLD-AGENT-ADOPTION-AND-PUBLIC-DISTRIBUTION.md`](../implementation/M17-REAL-WORLD-AGENT-ADOPTION-AND-PUBLIC-DISTRIBUTION.md) | Slice narrative |
| [`../release/M17_5_SDK_RELEASE_READINESS.md`](../release/M17_5_SDK_RELEASE_READINESS.md) | **1.1.3** line history |
| [`../release/M17_9_NPM_RELEASE_READINESS.md`](../release/M17_9_NPM_RELEASE_READINESS.md) | **1.1.4** release record |
| [`../engineering/REMOTE_HTTP_LOCAL_AGENT_SETUP.md`](../engineering/REMOTE_HTTP_LOCAL_AGENT_SETUP.md) | Operator setup |
| [`../roadmap/IMPLEMENTATION_TRACKER.md`](../roadmap/IMPLEMENTATION_TRACKER.md) | Milestone status |

## 8. M17 checklist

| Item | Status |
| --- | --- |
| Published SDK capability resources on npm | **PASS** |
| Example 19 + published connector adoption | **PASS** (scoped) |
| M17.8 real-world workflow | **PASS** |
| M17.9 npm **1.1.4** + install smoke | **PASS** |
| Milestone documentation closeout | **PASS** |

**M17 milestone status:** **Complete (scoped)**.
