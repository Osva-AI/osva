export interface OperatorEnv {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly requestTimeoutMs: number;
}

export class OperatorConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorConfigurationError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new OperatorConfigurationError(
      `Missing ${name}. Set this before running canonical operator commands.`,
    );
  }
  return value;
}

export function loadOperatorEnv(): OperatorEnv {
  return {
    baseUrl: requireEnv("OSVA_BASE_URL"),
    apiKey: requireEnv("OSVA_API_KEY"),
    workspaceId: requireEnv("OSVA_WORKSPACE_ID"),
    requestTimeoutMs: 120_000,
  };
}

export const CANONICAL_SETUP_STALE_MESSAGE = [
  "Canonical setup is missing or stale.",
  "Run: pnpm run canonical:setup",
].join("\n");

export const operatorRuntimePrerequisites = [
  "WorkflowRun execution requires OSVA web, worker, workflow-orchestrator, PostgreSQL, and Valkey.",
  "Research/Analysis RAG requires the KnowledgeIndex created by canonical setup to remain READY.",
  "MCP tool execution requires OSVA_MCP_STDIO_CONNECTORS_ENABLED=true on the worker.",
  "The worker must use the same OSVA_TRUSTED_RUNTIME_ROOT and model provider credentials as setup.",
  "Report artifact creation requires compatible artifact storage configuration on web and worker.",
].join("\n");
