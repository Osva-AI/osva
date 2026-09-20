# Stage 3.5 — Knowledge Core + Durable Ingestion + Retrieval

Stage 3.5 delivers durable knowledge objects, asynchronous ingestion, pgvector projections, control-plane retrieval, and **execution-plane** runtime retrieval through frozen bindings.

## Product objects

| Object | Role |
| --- | --- |
| **Artifact** | Immutable bytes + metadata (not a knowledge object) |
| **KnowledgeSource** | Immutable declaration that one workspace Artifact is a knowledge source |
| **KnowledgeIndex** | Durable materialized retrieval snapshot; owns ingestion lifecycle |
| **KnowledgeChunk** | Canonical OSVA-owned retrievable text |
| **Vector row** | Replaceable pgvector projection of a chunk embedding |

## Ingestion lifecycle (Run 1)

`PENDING → RUNNING → READY` or `FAILED`; `FAILED → PENDING` via explicit retry API.

PostgreSQL owns claims (`lease_token`, `lease_expires_at`, `attempt_count`). BullMQ carries `knowledgeIndexId` only.

## Agent manifest knowledge bindings (Run 2)

Optional `knowledge` map on `AgentManifestV1`:

```json
{
  "knowledge": {
    "company_docs": {
      "knowledgeIndexIds": ["ki_123", "ki_456"]
    }
  }
}
```

- Binding names follow the same rules as model/tool/memory binding names.
- Values are **immutable KnowledgeIndex IDs** (not KnowledgeSource IDs, no `"latest"`).
- At **AgentVersion** creation, each index must exist in the workspace and be `READY`.
- `AppendAgentVersion` rejects missing, wrong-workspace, or non-READY indexes.

## Effective run snapshot

`EffectiveRunBindings.knowledgeIndexBindings` freezes at **Run** creation:

```ts
Readonly<Record<string, readonly KnowledgeIndexId[]>>
```

- Always `{}` when absent from the manifest.
- Older persisted runs without the column map to `{}`.
- Retries and queue redelivery reuse persisted bindings; AgentManifest is not re-resolved.

Persisted on `runs.knowledge_index_bindings` (migration `0021_knowledge_runtime_slice.sql`).

## ExecutionRequest

`createExecutionRequest` copies `knowledgeIndexBindings` from the Run. Workers reconstruct execution from PostgreSQL, not the latest AgentVersion.

## Runtime retrieval (Run 2)

Agents call:

```ts
const hits = await context.knowledge.search("company_docs", {
  query: "What is our refund policy?",
  topK: 5,
  filter: { department: "finance" },
});
```

- **Trusted TypeScript**: IPC to parent `RuntimeKnowledgeGateway`.
- **Remote HTTP / Container**: `POST /v1/runtime/capabilities/knowledge/search` via capability token.
- **Node / Python runtime SDKs**: `context.knowledge.search(...)`.

OSVA resolves `bindingName → frozen knowledgeIndexBindings[bindingName] → KnowledgeRetriever`. Runtimes never supply arbitrary index IDs and never receive DB, pgvector, or embedding credentials.

Retrieved text is **untrusted data**; OSVA does not auto-inject it into prompts.

## Run steps and observability

Knowledge searches record `KNOWLEDGE` RunSteps (binding name, status, error code). Query text, chunk text, and embeddings are not persisted.

OpenTelemetry span `osva.knowledge.retrieve` records binding, index count, topK, result count, and error code (not query content).

## Supported source media types

- `text/plain`
- Markdown (`text/markdown`, `text/x-markdown`, `application/markdown`)
- `application/pdf` (PDF.js adapter; no network fetches)

## Embedding and vector store

`@osva/embedding-gateway` (deterministic in CI/test; OpenAI-compatible when configured). Community vector store: `@osva/adapters-vector-pgvector`.

## Processes

- `apps/web` — control-plane HTTP, agent registry, enqueue
- `apps/knowledge-worker` — ingestion only
- `apps/worker` — execution worker wires `KnowledgeRetriever` for runtime capability

## Configuration

| Variable | Purpose |
| --- | --- |
| `OSVA_KNOWLEDGE_EMBEDDING_PROVIDER` | Required in production (or `OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS`) |
| `OSVA_KNOWLEDGE_EMBEDDING_MODEL` | Embedding model id |
| `OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS` | Vector dimensions |
| `OSVA_KNOWLEDGE_EMBEDDING_API_KEY` | Optional OpenAI-compatible key |
| `OSVA_KNOWLEDGE_EMBEDDING_BASE_URL` | Optional OpenAI-compatible base URL |

Web, knowledge-worker, and execution worker must agree on provider, model, and dimensions.

## Migrations

- `0020_knowledge_retrieval_slice.sql` — knowledge tables + pgvector
- `0021_knowledge_runtime_slice.sql` — `runs.knowledge_index_bindings`, `KNOWLEDGE` run step kind

## Intentionally deferred

KnowledgeCollection, automatic RAG, hybrid/BM25, reranking, OCR, connector sync, alternate vector DBs, document-level ACLs, runtime knowledge mutation, and admin ingestion UI belong to later stages.
