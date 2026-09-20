# Memory and Knowledge

Distinct concepts:

- Run context;
- session memory;
- long-term memory;
- KnowledgeSource.

Stable interfaces:

```text
MemoryStore
KnowledgeIngestor
KnowledgeRetriever
```

Stage 2.8 introduces durable JSON key/value memory namespaces accessed only
through MemoryGateway. Namespaces are mutable containers; AgentVersion memory
bindings are immutable execution snapshots. This is not vector or semantic
memory.

Stage 3.5 Run 1 (control plane) adds durable KnowledgeSource, KnowledgeIndex,
KnowledgeChunk, and pgvector projections. Runtime `context.knowledge.search` returns hits as untrusted data; agents choose how to use them (no automatic prompt injection).
(mediated retrieval; runtimes never receive index IDs or vector credentials).

OSVA does not become a vector database; vector rows are infrastructure
projections of KnowledgeChunk embeddings.
