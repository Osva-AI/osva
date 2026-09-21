import { OSVA_MCP_TOOL_NAMES, type McpPrincipal } from "@osva/contracts";
import {
  osvaMcpAgentRunV1InputSchema,
  osvaMcpRunGetV1InputSchema,
  osvaMcpWorkflowRunGetV1InputSchema,
  osvaMcpWorkflowRunV1InputSchema,
} from "@osva/contracts/schemas";
import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import {
  OSVA_ATTR,
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";
import { OsvaApiError } from "@osva/sdk";

import type { OsvaClientFactory } from "./osva-client.js";
import { invalidInput, McpServerError, notFound } from "./errors.js";

const objectSchema = fromJsonSchema({
  type: "object",
  additionalProperties: true,
});

export interface RegisterOsvaMcpToolsOptions {
  readonly server: McpServer;
  readonly clients: OsvaClientFactory;
  readonly instrumentation?: OsvaInstrumentation;
  readonly principal: McpPrincipal;
}

export function registerOsvaMcpTools(
  options: RegisterOsvaMcpToolsOptions,
): void {
  const instrumentation = resolveInstrumentation(options.instrumentation);
  const { server, clients, principal } = options;

  server.registerTool(
    OSVA_MCP_TOOL_NAMES.AGENT_RUN_V1,
    {
      description:
        "Start a durable OSVA Run for a specific immutable AgentVersion.",
      inputSchema: objectSchema,
    },
    async (input) => {
      return await instrumentation.withSpan(
        OSVA_SPAN.MCP_INBOUND_TOOL,
        {
          [OSVA_ATTR.OPERATION]: OSVA_MCP_TOOL_NAMES.AGENT_RUN_V1,
        },
        async (span) => {
          try {
            const parsed = osvaMcpAgentRunV1InputSchema.safeParse(input);
            if (!parsed.success) {
              throw invalidInput("Invalid osva_agent_run_v1 input.");
            }

            const client = clients.forPrincipal(principal);
            span.setAttributes({
              [OSVA_ATTR.AGENT_VERSION_ID]: parsed.data.agentVersionId,
            });

            const created = await client.runs.create({
              agentId: parsed.data.agentId,
              agentVersionId: parsed.data.agentVersionId,
              input: parsed.data.input,
              idempotencyKey: parsed.data.idempotencyKey,
            });

            span.setAttributes({
              [OSVA_ATTR.RUN_ID]: created.run.id,
              [OSVA_ATTR.RUN_ATTEMPT_ID]: created.runAttempt.id,
            });

            return toolJsonResult({
              runId: created.run.id,
              runAttemptId: created.runAttempt.id,
              status: created.run.status,
            });
          } catch (error) {
            return mapToolError(span, error);
          }
        },
      );
    },
  );

  server.registerTool(
    OSVA_MCP_TOOL_NAMES.RUN_GET_V1,
    {
      description: "Get durable OSVA Run status and latest attempt output.",
      inputSchema: objectSchema,
    },
    async (input) => {
      return await instrumentation.withSpan(
        OSVA_SPAN.MCP_INBOUND_TOOL,
        {
          [OSVA_ATTR.OPERATION]: OSVA_MCP_TOOL_NAMES.RUN_GET_V1,
        },
        async (span) => {
          try {
            const parsed = osvaMcpRunGetV1InputSchema.safeParse(input);
            if (!parsed.success) {
              throw invalidInput("Invalid osva_run_get_v1 input.");
            }

            const client = clients.forPrincipal(principal);
            span.setAttributes({ [OSVA_ATTR.RUN_ID]: parsed.data.runId });

            const run = await client.runs.get(parsed.data.runId);
            assertWorkspaceOwnership(run.workspaceId, principal.workspaceId);

            const attempts = await client.runs.listAttempts(parsed.data.runId);
            const latest = attempts.attempts.at(-1);

            return toolJsonResult({
              runId: run.id,
              status: run.status,
              runAttemptId: latest?.id,
              runAttemptStatus: latest?.status,
              output: latest?.output,
              error: latest?.error,
            });
          } catch (error) {
            return mapToolError(span, error);
          }
        },
      );
    },
  );

  server.registerTool(
    OSVA_MCP_TOOL_NAMES.WORKFLOW_RUN_V1,
    {
      description:
        "Start a durable OSVA WorkflowRun for a specific immutable WorkflowVersion.",
      inputSchema: objectSchema,
    },
    async (input) => {
      return await instrumentation.withSpan(
        OSVA_SPAN.MCP_INBOUND_TOOL,
        {
          [OSVA_ATTR.OPERATION]: OSVA_MCP_TOOL_NAMES.WORKFLOW_RUN_V1,
        },
        async (span) => {
          try {
            const parsed = osvaMcpWorkflowRunV1InputSchema.safeParse(input);
            if (!parsed.success) {
              throw invalidInput("Invalid osva_workflow_run_v1 input.");
            }

            const client = clients.forPrincipal(principal);
            span.setAttributes({
              [OSVA_ATTR.WORKFLOW_VERSION_ID]: parsed.data.workflowVersionId,
            });

            const created = await client.workflowRuns.create({
              workflowVersionId: parsed.data.workflowVersionId,
              input: parsed.data.input as import("@osva/contracts").JsonValue,
            });

            span.setAttributes({
              [OSVA_ATTR.WORKFLOW_RUN_ID]: created.id,
            });

            return toolJsonResult({
              workflowRunId: created.id,
              status: created.status,
              workflowId: created.workflowId,
              workflowVersionId: created.workflowVersionId,
            });
          } catch (error) {
            return mapToolError(span, error);
          }
        },
      );
    },
  );

  server.registerTool(
    OSVA_MCP_TOOL_NAMES.WORKFLOW_RUN_GET_V1,
    {
      description: "Get durable OSVA WorkflowRun status and node runs.",
      inputSchema: objectSchema,
    },
    async (input) => {
      return await instrumentation.withSpan(
        OSVA_SPAN.MCP_INBOUND_TOOL,
        {
          [OSVA_ATTR.OPERATION]: OSVA_MCP_TOOL_NAMES.WORKFLOW_RUN_GET_V1,
        },
        async (span) => {
          try {
            const parsed = osvaMcpWorkflowRunGetV1InputSchema.safeParse(input);
            if (!parsed.success) {
              throw invalidInput("Invalid osva_workflow_run_get_v1 input.");
            }

            const client = clients.forPrincipal(principal);
            span.setAttributes({
              [OSVA_ATTR.WORKFLOW_RUN_ID]: parsed.data.workflowRunId,
            });

            const workflowRun = await client.workflowRuns.get(
              parsed.data.workflowRunId,
            );
            assertWorkspaceOwnership(
              workflowRun.workspaceId,
              principal.workspaceId,
            );

            return toolJsonResult({
              workflowRunId: workflowRun.id,
              status: workflowRun.status,
              workflowId: workflowRun.workflowId,
              workflowVersionId: workflowRun.workflowVersionId,
              output: workflowRun.output,
              error: workflowRun.error,
              nodeRuns: workflowRun.nodeRuns,
              approvalRequests: workflowRun.approvalRequests,
            });
          } catch (error) {
            return mapToolError(span, error);
          }
        },
      );
    },
  );
}

function assertWorkspaceOwnership(
  resourceWorkspaceId: string,
  principalWorkspaceId: string,
): void {
  if (resourceWorkspaceId !== principalWorkspaceId) {
    throw notFound("Resource was not found.");
  }
}

function toolJsonResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function mapToolError(
  span: { setStatus(ok: boolean, errorCategory?: string): void },
  error: unknown,
) {
  const mapped = mapError(error);
  span.setStatus(false, mapped.category);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          category: mapped.category,
          message: mapped.message,
        }),
      },
    ],
    structuredContent: {
      category: mapped.category,
      message: mapped.message,
    },
  };
}

function mapError(error: unknown): { category: string; message: string } {
  if (error instanceof McpServerError) {
    return { category: error.category, message: error.message };
  }

  if (error instanceof OsvaApiError) {
    if (error.status === 404) {
      return {
        category: "not_found",
        message: "Resource was not found.",
      };
    }
    return {
      category: "upstream",
      message: "OSVA API request failed.",
    };
  }

  return {
    category: "internal",
    message: "Unexpected MCP server error.",
  };
}
