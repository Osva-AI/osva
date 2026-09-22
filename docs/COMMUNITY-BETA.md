# OSVA Community Beta

> **Historical document.** Community Beta (Stage 2) is complete. For current OSS 1.0 installation and authenticated API usage, start with [`OSS-1.0-QUICKSTART.md`](./OSS-1.0-QUICKSTART.md). Capability notes below remain useful context but may omit Stage 3 features (artifacts, knowledge retrieval, MCP server, API security hardening, deployment packaging).

Stage 2 Community Beta was the first open-source milestone with a practical local path from Agent registry through multi-agent workflows, MCP, memory, evaluation, scheduling, optional OpenTelemetry, and basic AI Office.

**Legacy quickstart:** [`COMMUNITY-BETA-QUICKSTART.md`](./COMMUNITY-BETA-QUICKSTART.md)

## Capability matrix

| Capability | Status | Notes |
|------------|--------|-------|
| Agent registry / versioning | **Supported** | Immutable AgentVersion manifests |
| Runs / RunAttempts | **Supported** | PostgreSQL lifecycle authority |
| Workflow registry | **Supported** | Immutable WorkflowVersion |
| Sequential workflows | **Supported** | V1 linear AGENT chains |
| Branch / parallel / join | **Supported** | V2 DAG (`BRANCH`, `PARALLEL`, `JOIN`) |
| Multi-agent composition | **Supported** | Different AgentVersions per workflow node |
| Approval primitive | **Supported** | Durable `APPROVAL` node + ApprovalRequest API |
| Scheduling | **Supported** | Cron + timezone; scheduler process |
| Trusted TypeScript runtime | **Supported** | Operator-installed trusted entrypoints |
| Remote HTTP runtime | **Supported** | Runtime Protocol V1 + capability bridge |
| Node SDK | **Supported** | `@osva/sdk` over `/v1` |
| Python SDK | **Supported** | `osva-sdk` package |
| CLI | **Supported** | `@osva/cli` via Node SDK |
| OpenAI models | **Supported** | Optional worker API key |
| Anthropic models | **Supported** | Optional worker API key |
| Google Gemini models | **Supported** | Optional worker API key |
| Internal tools | **Supported** | ToolGateway + OSVA_ECHO_V1 etc. |
| MCP HTTP | **Supported** | Streamable HTTP transport |
| MCP stdio | **Supported** | Managed local MCP child process |
| Persistent memory | **Supported** | JSON key/value MemoryNamespaces |
| Evaluation suites | **Supported** | JSON_EXACT_MATCH; child Runs |
| OpenTelemetry | **Supported** | Optional OTLP traces/metrics |
| Basic AI Office | **Supported** | OfficeWorker, Team, Role, Goal, Assignment |
| Auth / RBAC | **Not yet supported** | No enterprise identity layer |
| Vector memory / RAG | **Not yet supported** | Stage 3+ |
| LLM-as-judge evaluation | **Not yet supported** | Deterministic evaluators only |
| Model streaming | **Not yet supported** | Synchronous text generation |
| Native model function calling | **Not yet supported** | Tools via ToolGateway |
| OSVA as MCP server | **Not yet supported** | MCP client only |
| Production deployment packaging | **Not yet supported** | Local dev topology only |
| HA / clustering | **Not yet supported** | Single-process dev model |

## Explicit non-goals

Community Beta intentionally excludes:

- Enterprise SSO / SCIM
- Enterprise RBAC / policy administration UI
- Hard multi-tenancy guarantees
- HA / production clustering
- Private workers / hybrid VPC execution
- Production Docker/Kubernetes/Helm packaging
- Hosted OSVA service
- Vector memory / semantic search / RAG
- LLM-as-judge evaluators
- Advanced AI Office (departments, managers, workforce planner, team routing)
- OAuth connector flows
- OSVA exposed as an MCP server
- Streaming model responses
- Native provider function/tool calling
- Generalized provider routing / automatic fallback
- Stable OSS 1.0 compatibility guarantees

Stage 3 owns OSS 1.0 packaging, container execution, and production deployment concerns.

## Architecture references

- [`architecture/ARCHITECTURE_OVERVIEW.md`](./architecture/ARCHITECTURE_OVERVIEW.md)
- [`architecture/DATA_FLOWS.md`](./architecture/DATA_FLOWS.md)
- [`platform/AI_OFFICE_LAYER.md`](./platform/AI_OFFICE_LAYER.md)
- [`architecture/OPENTELEMETRY.md`](./architecture/OPENTELEMETRY.md)
