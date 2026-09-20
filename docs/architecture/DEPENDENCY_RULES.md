# Dependency Rules

Dependency direction as implemented after Stage 2.8.

## Core direction

```text
apps (composition roots)
  → adapters (infrastructure)
  → contracts (ports + public types)
  ↑
domain / orchestration / gateways / runtime-core (services)
```

**Rule:** Domain, orchestration, and gateway packages must not import concrete adapters (BullMQ, Drizzle repositories in domain, OpenAI SDK, etc.).

**Rule:** Composition roots in `apps/*` wire ports to adapters.

## Layer rules

| Rule | Implementation |
|------|----------------|
| Domain/contracts must not depend on provider SDKs | Provider SDK imports exist only under `adapters/model-*` |
| Provider adapters depend inward on OSVA contracts | Implement `ModelProviderAdapter` from `@osva/model-gateway` |
| Runtime implementations use capability contracts | Runtimes receive bindings/grants, call gateway-shaped capabilities |
| ModelGateway owns model mediation | Worker constructs one ModelGateway; runtimes never import OpenAI |
| ToolGateway owns tool mediation | All tool invoke paths go through ToolGateway.invoke |
| MemoryGateway owns persistent runtime memory | Namespace IDs never exposed to agent code |
| MCP remains adapter beneath ToolGateway | `invokeMcpToolVersion` called from ToolGateway only |
| PostgreSQL repositories implement domain ports | `packages/db/src/repositories/postgres-*.ts` |
| BullMQ carries work, not lifecycle | Job payload is `{ runAttemptId }`; CreateRun owns attempt creation |
| apps/web is control-plane composition | HTTP + persist + enqueue |
| apps/worker is execution-plane composition | consume + ExecuteRunAttempt + gateways |
| Public SDKs depend on public HTTP contracts | `@osva/sdk` mirrors `/v1` resources |
| CLI depends on Node SDK | `@osva/cli` → `@osva/sdk`, no duplicate HTTP client |
| Remote runtime never receives DB/queue/provider credentials | Capability bridge + scoped tokens only |

## Package-specific boundaries

### packages/domain

- May import `@osva/contracts`.
- Defines repository **ports**, not Postgres implementations.
- State machines and aggregates live here.

### packages/orchestration

- May import `@osva/domain`, `@osva/contracts`, `@osva/runtime-core`.
- Must not import `apps/*` or adapters.
- Accepts `JobQueue` and `RuntimeAdapter` as injected ports.

### packages/db

- Implements domain repository ports.
- May import Drizzle, `@osva/domain` types/ports.
- Must not import gateway or runtime adapter packages.

### Gateway packages (model/tool/memory)

- Implement contract ports.
- May import domain repositories for version/binding lookup.
- Must not import runtime adapters or apps.

### packages/observability

- Wraps gateway interfaces for RunStep recording.
- Used only from execution plane composition.

### adapters/runtime-http

- Depends on runtime-protocol and runtime-core.
- Capability bridge receives gateway **instances** from worker composition root.
- Secret resolver reads env at adapter boundary.

### adapters/runtime-container

- Depends on runtime-protocol, runtime-core, and runtime-http (capability token issuance only).
- `ContainerEngine` is an internal infrastructure seam; Docker/dockerode stay behind it.
- Must not import domain aggregates, gateway implementations, or provider SDKs.
- Worker composition root supplies operator network/resource policy and container-reachable capability URL.
- Container code receives scoped capability tokens only; worker signing secrets never enter containers.

## Knowledge (Stage 3.5 Run 1)

```text
apps/web / apps/knowledge-worker
        ↓
domain knowledge application + KnowledgeIngestionService + KnowledgeRetriever
        ↓
contracts + domain ports (KnowledgeRepository, VectorStore, EmbeddingGateway, KnowledgeParser)

concrete parser / embedding / vector / queue / DB implementations
        ↑ wired only by composition roots (web, knowledge-worker)
```

| Rule | Implementation |
|------|----------------|
| Knowledge domain must not import pgvector | `VectorStore` port in domain; `PgVectorStore` in `adapters/vector-pgvector` |
| Knowledge domain must not import PDF.js | PDF parsing only in `adapters/knowledge-parser` |
| Knowledge domain must not import OpenAI SDK types | `EmbeddingGateway` + `adapters/embedding-openai-compatible` |
| Parser implementations are adapters | `OsvaKnowledgeParserRegistry` implements `KnowledgeParserRegistry` port |
| Artifact remains separate | Ingestion reuses `createArtifactApplication`; knowledge tables reference `artifacts` |
| BullMQ knowledge queue is transport-only | `KnowledgeIndexQueue` payload is `knowledgeIndexId`; leases live in PostgreSQL |

Runtime `context.knowledge` is implemented via `@osva/observability` RunSteps, `RuntimeKnowledgeGateway` in domain, capability bridge in `@osva/adapters-runtime-http`, and worker composition (`KnowledgeRetriever` + adapters). Runtimes depend on contracts/protocol only.

## Cross-cutting rules

| Concern | Authority | Transport |
|---------|-----------|-----------|
| Run / RunAttempt lifecycle | PostgreSQL + domain state machines | BullMQ notifies worker |
| WorkflowRun / WorkflowNodeRun | PostgreSQL + reconciler | BullMQ for child RunAttempts only |
| Approval waiting | PostgreSQL ApprovalRequest | Not BullMQ |
| Schedule occurrences | PostgreSQL ScheduleOccurrence | BullMQ after CreateRun |
| EvaluationRun progress | PostgreSQL + EvaluationCoordinator | Child Runs via normal queue |

## Intentional composition-root coupling

These are deliberate, not layer violations:

1. **apps/web** imports `@osva/adapters-bullmq` to enqueue after persist.
2. **apps/knowledge-worker** imports parser, embedding, vector, artifact, and BullMQ knowledge queue adapters.
3. **apps/worker** imports all execution adapters (runtime, model, MCP) in one place.
4. **apps/web** imports `@osva/adapters-mcp-client` for control-plane MCP discovery only.
5. **packages/observability** imports concrete gateway classes for wrapping (execution-plane only).

## Test doubles

`adapters/memory` provides in-memory repository and fake runtime implementations for unit/contract tests. Not used in production composition roots.

## Known doc vs code note

`docs/engineering/REPOSITORY_STRUCTURE.md` lists planned adapter names (`queue-bullmq`, `runtime-node`) that differ from actual package names (`adapters/bullmq`, `adapters/runtime-typescript`). Follow the repository map, not the planned names.
