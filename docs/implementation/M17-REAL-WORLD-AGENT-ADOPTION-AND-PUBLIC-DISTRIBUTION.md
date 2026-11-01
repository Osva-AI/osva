# M17 — Real-world agent adoption and public distribution

**Baseline:** Community platform **`1.1.1`** (GHCR / PyPI / Helm) · Drizzle head **`0030_approval_operation_binding_slice`**.

**Prior milestones:** M16 installer and external-consumer acceptance ([`../release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md`](../release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md)) · M15 production adoption closeout ([`../operations/M15_CLOSEOUT_SUMMARY.md`](../operations/M15_CLOSEOUT_SUMMARY.md)).

**Objective:** Prove that external agent developers can adopt OSVA using **published** npm SDK/CLI packages, a **published** npm MCP connector, and a real-world host-based REMOTE_HTTP workflow against platform **1.1.1** — then ship coordinated npm **1.1.4** with local REMOTE_HTTP developer setup.

Verification policy: [`../engineering/DEVELOPMENT_GATES.md`](../engineering/DEVELOPMENT_GATES.md). Milestone evidence: [`../operations/M17_ACCEPTANCE_SUMMARY.md`](../operations/M17_ACCEPTANCE_SUMMARY.md) · Closeout: [`../operations/M17_CLOSEOUT_SUMMARY.md`](../operations/M17_CLOSEOUT_SUMMARY.md).

## Version coordinates (do not conflate)

| Surface | Version | Notes |
| --- | --- | --- |
| OSVA platform (VERSION, GHCR, PyPI, Helm, CLI `distribution.json`) | **1.1.1** | Unchanged for M17.8/M17.9 |
| Public npm `@osva-ai/*` (five packages) | **1.1.4** | `NPM_DISTRIBUTION_VERSION` after M17.9 |
| Python `osva-sdk` (PyPI) | **1.1.1** | Unchanged in M17 |
| Published npm MCP connector (separate package) | **`@osva-ai/connector-npm@0.1.0`** | Not part of the five-package graph |

## Progress

| Slice | Status | Notes |
| --- | --- | --- |
| M17.2 SDK capability resources | **Complete** | PR **#75** → **`3270f55`** — `modelProfiles`, `connectors`, `tools` on `@osva-ai/sdk` |
| M17.2–M17.7 Public SDK, Example 19, and connector distribution | **Complete (scoped)** | Registry + external-example adoption; see acceptance summary §2 |
| M17.5 npm **1.1.3** SDK distribution readiness | **Complete** | PR **#76** → **`9a78874`** · [`../release/M17_5_SDK_RELEASE_READINESS.md`](../release/M17_5_SDK_RELEASE_READINESS.md) |
| M17.8 Real-world REMOTE_HTTP integration acceptance | **Complete (operator)** | PR **#77** → **`6cdf1d7`** · workflow evidence **M17.8** (run id recorded in acceptance summary) |
| M17.9 Coordinated npm **1.1.4** release | **Complete** | PR **#78** → **`f9fa20e`** · [`../release/M17_9_NPM_RELEASE_READINESS.md`](../release/M17_9_NPM_RELEASE_READINESS.md) |
| M17 closeout | **Complete** | This document + acceptance/closeout summaries; roadmap tracker updated |

## M17.2 — SDK capability resources

**Delivered (in-repo):**

- Typed SDK resources for model profiles, connectors (including MCP discovery/import), and tools.
- Focused unit tests: `packages/sdk/test/capability-resources.test.ts`.

**Acceptance:** Merged **`main`** via PR **#75**; consumer smoke extended in M17.5 release prep.

## M17.2–M17.7 — Published SDK, Example 19, and npm connector

**Scope (distribution + external example, not platform feature work):**

- Publish npm packages that include M17.2 SDK resources (coordinated **`1.1.3`** then **`1.1.4`** lines).
- Integrate **Example 19** (canonical dependency adoption journey) with the **published** `@osva-ai/sdk` (and aligned `@osva-ai/*` pins).
- Publish **`@osva-ai/connector-npm@0.1.0`** and migrate Example 19 to the published connector package.

**In-repo anchor:** M7 fixture [`../../examples/canonical-dependency-adoption/README.md`](../../examples/canonical-dependency-adoption/README.md) (`npm_package_metadata`, `npm_downloads` tools).

**Acceptance:** Recorded in [`../operations/M17_ACCEPTANCE_SUMMARY.md`](../operations/M17_ACCEPTANCE_SUMMARY.md) §2 — registry publication and operator replay; not re-proven by M17.9 clean install alone.

## M17.5 — npm 1.1.3 SDK distribution

**Delivered:**

- Bump `NPM_DISTRIBUTION_VERSION` to **1.1.3** across all five public npm packages.
- Release readiness doc and extended `npm-consumer-smoke` capability-resource import checks.

**Acceptance:** PR **#76** merged; maintainer publication to npm **`stable-candidate`** / **`latest`** superseded by **1.1.4** in M17.9 (see acceptance summary).

## M17.8 — Real-world integration acceptance

**Delivered (in-repo):**

- Opt-in **`osva setup --remote-http-dev`** profile, bundled Compose overlay, installation-specific capability secret, loopback capability listener (**127.0.0.1:8787** default).
- Engineering guide: [`../engineering/REMOTE_HTTP_LOCAL_AGENT_SETUP.md`](../engineering/REMOTE_HTTP_LOCAL_AGENT_SETUP.md).

**Delivered (operator acceptance on platform 1.1.1):**

- MCP tools **`npm_package_metadata`** and **`npm_downloads`** succeeded.
- OpenAI model execution succeeded.
- Workflow run succeeded; markdown artifact persisted and downloaded.
- Model and tool observability verified.
- Canonical execution run id: **`a409acad-b3be-47d1-97fc-689158f39b54`**.

**Acceptance:** PR **#77** merged for CLI/Compose wiring; end-to-end model/tool/workflow proof is **M17.8 operator evidence** (not duplicated by M17.9 install smoke).

## M17.9 — Coordinated npm 1.1.4

**Delivered:**

- `NPM_DISTRIBUTION_VERSION` **1.1.4**; functional delta vs **1.1.3** is CLI **`--remote-http-dev`** (version-alignment republish for the other four packages).
- PR **#78** merged; CI **`verify`** **SUCCESS** on merge commit **`f9fa20e`**.

**Post-merge operator publication (recorded at closeout):**

- All five `@osva-ai/*@1.1.4` packages on npm; dist-tags **`latest`** and **`stable-candidate`** → **1.1.4**.
- `node scripts/release/npm-registry-consumer-smoke.mjs` **PASS**.
- Clean global install **`@osva-ai/cli@1.1.4`** and **`osva setup --remote-http-dev`** provisioning (platform **1.1.1** image, services up, administrator bootstrap, capability secret, **127.0.0.1:8787** bind) — **PASS** (operator workstation evidence; see acceptance summary §4).

**Not claimed:** M17.9 install smoke does **not** independently rerun the full M17.8 model/tool workflow.

## Deferred scope (not M17 acceptance)

- Registry-only harness target frozen at M16 npm **1.1.2** (`m16-111` in `scripts/acceptance/r11-registry-only/lib/targets.mjs`) — updating to **1.1.4** is follow-on maintenance, not required to close M17 documentation.
- PyPI/GHCR republication beyond existing **1.1.1** platform pins.
- Automated in-repo replay of M17.8 operator workflow (no committed acceptance harness slice).
- M15 distribution deferrals (PyPI RC lines, GHCR tag matrix refresh, M10.4E replay) remain open unless separately closed.
