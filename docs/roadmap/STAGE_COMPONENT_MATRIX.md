# Stage Component Matrix

| Subsystem | Contract | Stage 0 | Stage 1 | Stage 2 | OSS 1.0 |
|---|---|---|---|---|---|
| DB | repositories | PostgreSQL foundation | PostgreSQL | PostgreSQL | production topology |
| Job dispatch | JobQueue | fake | BullMQ | BullMQ | pluggable |
| Durable workflows | DurableWorkflowBackend | boundary | none | OSVA DAG coordinator | durable adapter |
| Runtime | RuntimeAdapter | contract | trusted TS | trusted TS + remote HTTP | container |
| Models | ModelGateway | contract | first provider | multi-provider | routing hooks |
| Tools | Tool contract | contract | internal | HTTP/MCP | connector SDK |
| Secrets | SecretResolver | contract | env | additional | pluggable |
| Artifacts | ArtifactStore | contract | local | local | S3-compatible |
| Memory | MemoryStore | contract | none | namespaces | pluggable |
| Knowledge | KnowledgeRetriever | contract | none | none | adapters |
| Telemetry | TelemetrySink | contract | native | OTEL | richer export |
| Evaluation | Evaluator | contract | basic | suites | gates |
| AI Office | Office domain | conceptual | conceptual | basics | richer |
