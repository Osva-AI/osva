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

Still ahead: deeper isolation, richer AI Office, ecosystem scale, advanced policy, OIDC (Community), and Teams/Enterprise identity (SAML/SCIM).
