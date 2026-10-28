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

Still ahead (post-M15): deeper isolation, richer AI Office, ecosystem scale, advanced policy, OIDC (Community), and Teams/Enterprise identity (SAML/SCIM).
