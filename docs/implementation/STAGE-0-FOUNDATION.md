# Stage 0 Foundation

## Goal
Create the permanent architectural skeleton.

## Build

- pnpm TypeScript monorepo;
- apps/web shell;
- apps/worker shell;
- packages/domain;
- packages/contracts;
- packages/db;
- packages/orchestration;
- packages/runtime-core;
- test fake adapters;
- PostgreSQL local infrastructure;
- Redis local infrastructure;
- lint;
- typecheck;
- tests;
- GitHub Actions.

## Do not build

- LLM Agent behavior;
- production Tools;
- MCP;
- workflows;
- memory/RAG;
- AI Office UI;
- sandboxing.

## Exit

Domain/tests compile without concrete provider/queue imports.
