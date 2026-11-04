# Stage Roadmap

## Stage 0: Foundation

Build:

- contracts;
- monorepo;
- domain packages;
- persistence foundation;
- fake/test adapters;
- CI;
- local infrastructure.

No production AI features.

## Stage 1: Community Alpha

Add:

- Agent registry;
- AgentVersions;
- Runs/RunAttempts;
- BullMQ JobQueue adapter;
- ExecutionWorker;
- trusted TypeScript runtime;
- schedules;
- first ModelGateway provider;
- Tool/ToolVersion;
- logs/usage/evals;
- Docker Compose.

AI Office remains conceptual.

## Stage 2: Community Beta

Add:

- Runtime Protocol V1 and remote HTTP runtime;
- Node/Python SDKs;
- versioned Workflows;
- multi-agent composition;
- multiple providers;
- MCP client;
- connectors;
- memory namespaces;
- OpenTelemetry;
- CLI/SDK;
- basic OfficeWorker/Team/Role/Goal/Assignment.

## Stage 3: OSS 1.0

Add/stabilize:

- container runtime;
- durable workflow adapter;
- stable Workflow Definition v1;
- human/event waits;
- ArtifactStore;
- KnowledgeSources/retrieval;
- MCP server;
- Connector SDK;
- stable API/contracts;
- Helm;
- migration tooling;
- security hardening.

## Post-1.0

Delivered in the Community **`1.1.x`** line (see [`IMPLEMENTATION_TRACKER.md`](IMPLEMENTATION_TRACKER.md)):

- Developer experience (M7–M10): canonical examples, Console product surfaces, CLI agent workflow, release packaging.
- **M11:** human identity, Better Auth password sessions, fixed workspace roles, Console login and membership administration ([`../operations/M11_CLOSEOUT_SUMMARY.md`](../operations/M11_CLOSEOUT_SUMMARY.md)).
- **M12:** model/tool/connector capability foundation and registered artifact storage ([`../operations/M12_4_CLOSEOUT_SUMMARY.md`](../operations/M12_4_CLOSEOUT_SUMMARY.md)).
- **M13:** no-code Console studios (Agent, Knowledge, Workflow, Testing) including evaluation scoring and quality gates ([`../operations/M13_CLOSEOUT_SUMMARY.md`](../operations/M13_CLOSEOUT_SUMMARY.md)).
- **M14:** security hardening — ToolGateway/MCP authorization, human-session abuse controls, capability tokens, adversarial acceptance, operation-bound workflow approvals, audit durability, incident response ([`../operations/M14_7_SECURITY_CLOSEOUT.md`](../operations/M14_7_SECURITY_CLOSEOUT.md)). Shipped on Community **`1.1.0-rc.4`** (npm **`rc`** dist-tag; see [`../release/RC4_VERIFICATION.md`](../release/RC4_VERIFICATION.md)).

### M15 — Production adoption and operational experience (complete, scoped)

Delivered operator-trustworthy **in-repository** adoption evidence for **`1.1.0-rc.4`**: docs/upgrade reconciliation, Evaluation Studio browser gap closed, Console operator diagnostics, unified `pnpm acceptance:m15` replay, and closeout summaries ([`../operations/M15_ACCEPTANCE_SUMMARY.md`](../operations/M15_ACCEPTANCE_SUMMARY.md)).

| Slice | Status |
| --- | --- |
| **M15.1** | **Complete** — baseline docs and RC.4 verification record |
| **M15.2** | **Complete** — quality-gate Playwright acceptance |
| **M15.3** | **Complete** — operator diagnostics hardening |
| **M15.4** | **Complete** — unified acceptance orchestration; **`full`** profile **PASS** |
| **M15.5** | **Complete** — milestone closeout; partial RC.4 distribution documented |

**Not implied by M15:** full PyPI/GHCR RC.4 publication, M10.4E tarball-only adoption certification, or independent real-world operator sign-off without fixture harnesses.

### M16 — Installer, lifecycle, and external-consumer acceptance (complete)

Delivered platform **1.1.1** with npm **1.1.2** installer/lifecycle CLI, Console onboarding improvements, and registry-verified **`m16-111`** acceptance ([`../release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md`](../release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md)).

### M17 — Real-world agent adoption and public distribution (complete, scoped)

Delivered **published** Node SDK capability resources, **Example 19** on published SDK and **`@osva-ai/connector-npm@0.1.0`**, M17.8 real-world REMOTE_HTTP workflow acceptance on platform **1.1.1**, and coordinated npm **1.1.4** with **`osva setup --remote-http-dev`** ([`../operations/M17_CLOSEOUT_SUMMARY.md`](../operations/M17_CLOSEOUT_SUMMARY.md) · [`../operations/M17_ACCEPTANCE_SUMMARY.md`](../operations/M17_ACCEPTANCE_SUMMARY.md)).

| Slice | Status |
| --- | --- |
| **M17.2–M17.7** | **Complete** — published SDK/connector; Example 19 adoption (scoped) |
| **M17.8** | **Complete** — REMOTE_HTTP dev setup + real-world model/tool/workflow evidence |
| **M17.9** | **Complete** — npm **1.1.4** publication and clean CLI install smoke |

**Not implied by M17:** M17.9 clean install reruns the M17.8 full workflow; automated **`m16-111`** harness refresh to npm **1.1.4**; PyPI/GHCR republication beyond **1.1.1** platform pins.

### M18 — Console UX V2 (complete, scoped)

Delivered the **UX V2** Console product line: design foundation (M18.1–M18.5), global shell through Resources (PR **#85–#91**), mocked and live browser acceptance, and CI **`verify`** success on merge **#91** ([`../operations/M18_CLOSEOUT_SUMMARY.md`](../operations/M18_CLOSEOUT_SUMMARY.md)).

| Slice | Status |
| --- | --- |
| **M18.1–M18.5** | **Complete** — shell, home, discovery, onboarding, Agent Studio refinement |
| **UX V2.1–V2.7** | **Complete** — shell, home, onboarding, Agent/Workflow studios, activity, resources |
| **M18.10** | **Complete** — closeout with documented verification exceptions |

**Not implied by M18:** unconditional **`verify:branch --profile=integration` LOCAL_PASS** on a V2.7-sized diff; WCAG/Lighthouse certification; platform or npm version changes.

### M19 — Ecosystem readiness (next)

Cross-repository audit and execution plan: [`../operations/M19_ECOSYSTEM_READINESS_AUDIT.md`](../operations/M19_ECOSYSTEM_READINESS_AUDIT.md). Prioritized slices **M19.1–M19.6** (compatibility truth, Example 19 external harness, connector publication/SDK alignment, examples **1.1.x** track, adapters/sidecar distribution, integration hardening).

Still ahead (post-M19): deeper isolation, richer AI Office, advanced policy, OIDC (Community), and Teams/Enterprise identity (SAML/SCIM).
