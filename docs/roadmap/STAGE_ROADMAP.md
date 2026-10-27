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

### M15 — Production adoption and operational experience (in progress)

Turn shipped **`1.1.0-rc.4`** product and security work into operator-trustworthy adoption evidence: reconcile docs and upgrade paths with the real migration journal, close Console evaluation UX gaps called out in M13 closeout, harden day-two operator flows, and run a unified adoption acceptance pass before declaring production-adoption ready.

| Slice | Focus |
| --- | --- |
| **M15.1** | Baseline and roadmap reconciliation — tracker, upgrade runbook, RC.4 verification record, Console surface docs ([`../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md`](../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md)) |
| **M15.2** | Evaluation Studio browser acceptance — Playwright coverage for quality-gate launch/detail and INDETERMINATE presentation (M13.7.5 doc gap) |
| **M15.3** | Operator experience hardening — setup/upgrade friction, runbooks, Console error and wait-state clarity |
| **M15.4** | Unified adoption acceptance — single harness replaying canonical example + Console human-session journeys on published or source-built **`1.1.0-rc.4`** artifacts |
| **M15.5** | Production adoption closeout — acceptance summaries, residual risks, compatibility and release notes |

Still ahead (post-M15): deeper isolation, richer AI Office, ecosystem scale, advanced policy, OIDC (Community), and Teams/Enterprise identity (SAML/SCIM).
