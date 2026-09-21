import type {
  AgentId,
  AgentVersionId,
  RunId,
  WorkflowId,
  WorkflowRunId,
  WorkflowVersionId,
  WorkspaceId,
} from "./ids.js";

export const OSVA_MCP_TOOL_NAMES = {
  AGENT_RUN_V1: "osva_agent_run_v1",
  RUN_GET_V1: "osva_run_get_v1",
  WORKFLOW_RUN_V1: "osva_workflow_run_v1",
  WORKFLOW_RUN_GET_V1: "osva_workflow_run_get_v1",
} as const;

export type OsvaMcpToolName =
  (typeof OSVA_MCP_TOOL_NAMES)[keyof typeof OSVA_MCP_TOOL_NAMES];

export const OSVA_MCP_RESOURCE_URI_PREFIX = "osva://v1";

export const OSVA_MCP_ERROR_CATEGORY = {
  AUTHENTICATION: "authentication",
  AUTHORIZATION: "authorization",
  INVALID_INPUT: "invalid_input",
  NOT_FOUND: "not_found",
  UPSTREAM: "upstream",
  INTERNAL: "internal",
} as const;

export type OsvaMcpErrorCategory =
  (typeof OSVA_MCP_ERROR_CATEGORY)[keyof typeof OSVA_MCP_ERROR_CATEGORY];

export interface McpPrincipal {
  readonly workspaceId: WorkspaceId;
}

export interface OsvaMcpAgentRunV1Input {
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly input: unknown;
  readonly idempotencyKey?: string;
}

export interface OsvaMcpAgentRunV1Output {
  readonly runId: RunId;
  readonly runAttemptId: string;
  readonly status: string;
}

export interface OsvaMcpRunGetV1Input {
  readonly runId: RunId;
}

export interface OsvaMcpRunGetV1Output {
  readonly runId: RunId;
  readonly status: string;
  readonly runAttemptId?: string;
  readonly runAttemptStatus?: string;
  readonly output?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface OsvaMcpWorkflowRunV1Input {
  readonly workflowVersionId: WorkflowVersionId;
  readonly input: unknown;
}

export interface OsvaMcpWorkflowRunV1Output {
  readonly workflowRunId: WorkflowRunId;
  readonly status: string;
  readonly workflowId: WorkflowId;
  readonly workflowVersionId: WorkflowVersionId;
}

export interface OsvaMcpWorkflowRunGetV1Input {
  readonly workflowRunId: WorkflowRunId;
}

export type OsvaMcpWorkflowRunGetV1Output = {
  readonly workflowRunId: WorkflowRunId;
  readonly status: string;
  readonly workflowId: WorkflowId;
  readonly workflowVersionId: WorkflowVersionId;
  readonly output?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
  readonly nodeRuns: readonly unknown[];
  readonly approvalRequests: readonly unknown[];
};

export type OsvaMcpResourceKind =
  | "agents"
  | "agent-versions"
  | "workflows"
  | "workflow-versions"
  | "run"
  | "workflow-run";

export interface ParsedOsvaMcpResourceUri {
  readonly kind: OsvaMcpResourceKind;
  readonly agentId?: AgentId;
  readonly workflowId?: WorkflowId;
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
}

export function buildOsvaMcpResourceUri(segments: readonly string[]): string {
  const normalized = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0);
  return `${OSVA_MCP_RESOURCE_URI_PREFIX}/${normalized.join("/")}`;
}

export function parseOsvaMcpResourceUri(
  uri: string,
): ParsedOsvaMcpResourceUri | undefined {
  const prefix = `${OSVA_MCP_RESOURCE_URI_PREFIX}/`;
  if (!uri.startsWith(prefix)) {
    return undefined;
  }

  const rest = uri.slice(prefix.length);
  const parts = rest.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }

  if (parts.length === 1 && parts[0] === "agents") {
    return { kind: "agents" };
  }

  if (parts.length === 3 && parts[0] === "agents" && parts[2] === "versions") {
    return { kind: "agent-versions", agentId: parts[1] as AgentId };
  }

  if (parts.length === 1 && parts[0] === "workflows") {
    return { kind: "workflows" };
  }

  if (
    parts.length === 3 &&
    parts[0] === "workflows" &&
    parts[2] === "versions"
  ) {
    return { kind: "workflow-versions", workflowId: parts[1] as WorkflowId };
  }

  if (parts.length === 2 && parts[0] === "runs") {
    return { kind: "run", runId: parts[1] as RunId };
  }

  if (parts.length === 2 && parts[0] === "workflow-runs") {
    return {
      kind: "workflow-run",
      workflowRunId: parts[1] as WorkflowRunId,
    };
  }

  return undefined;
}
