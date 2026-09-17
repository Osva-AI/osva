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

OSS 1.0 introduces general KnowledgeSource/retrieval adapters.

OSVA does not become a vector database.
