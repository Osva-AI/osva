# Stage 3 OSS 1.0

## Progress (implementation tracker)

| Area | Status |
|------|--------|
| Stage 3.2 durable workflow semantics | Complete in repo |
| Stage 3.3 durable workflow backend | Complete in repo |
| Stage 3.4 Artifact storage | **Complete** |
| Stage 3.5 Knowledge retrieval | **Complete** (Run 1 control-plane + Run 2 runtime bindings and `context.knowledge`) |

## Build/stabilize

- container runtime;
- stronger isolation;
- durable workflow adapter;
- stable Workflow Definition v1;
- waits/events/human tasks;
- S3-compatible ArtifactStore (Run 2; Run 1 ships filesystem BlobStore);
- knowledge/retrieval adapters;
- MCP server;
- Connector SDK;
- stable public API;
- migration tooling;
- Helm;
- security hardening.

## Release gate

1. public contracts versioned;
2. upgrades preserve Run history;
3. adapters have contract tests;
4. deployment documented;
5. security assumptions explicit.
