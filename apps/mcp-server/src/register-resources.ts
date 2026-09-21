import {
  OSVA_MCP_RESOURCE_URI_PREFIX,
  buildOsvaMcpResourceUri,
} from "@osva/contracts";
import type { McpPrincipal } from "@osva/contracts";
import type { McpServer } from "@modelcontextprotocol/server";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import {
  OSVA_ATTR,
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";
import { OsvaApiError } from "@osva/sdk";

import type { OsvaClientFactory } from "./osva-client.js";
import { notFound } from "./errors.js";

export interface RegisterOsvaMcpResourcesOptions {
  readonly server: McpServer;
  readonly clients: OsvaClientFactory;
  readonly instrumentation?: OsvaInstrumentation;
  readonly principal: McpPrincipal;
}

export function registerOsvaMcpResources(
  options: RegisterOsvaMcpResourcesOptions,
): void {
  const instrumentation = resolveInstrumentation(options.instrumentation);
  const { server, clients, principal } = options;

  const agentsUri = buildOsvaMcpResourceUri(["agents"]);
  server.registerResource(
    "osva-agents",
    agentsUri,
    {
      description: "Workspace-scoped OSVA agents.",
      mimeType: "application/json",
    },
    async () =>
      await readResource(instrumentation, "agents", agentsUri, async () => {
        const client = clients.forPrincipal(principal);
        const list = await client.agents.list();
        const agents = list.agents.filter(
          (agent) => agent.workspaceId === principal.workspaceId,
        );
        return { agents };
      }),
  );

  const workflowsUri = buildOsvaMcpResourceUri(["workflows"]);
  server.registerResource(
    "osva-workflows",
    workflowsUri,
    {
      description: "Workspace-scoped OSVA workflows.",
      mimeType: "application/json",
    },
    async () =>
      await readResource(
        instrumentation,
        "workflows",
        workflowsUri,
        async () => {
          const client = clients.forPrincipal(principal);
          const list = await client.workflows.list();
          const workflows = list.workflows.filter(
            (workflow) => workflow.workspaceId === principal.workspaceId,
          );
          return { workflows };
        },
      ),
  );

  server.registerResource(
    "osva-agent-versions",
    new ResourceTemplate(
      `${OSVA_MCP_RESOURCE_URI_PREFIX}/agents/{agentId}/versions`,
      {
        list: undefined,
      },
    ),
    {
      description:
        "Immutable AgentVersions for an agent in the authenticated workspace.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const resourceUri = normalizeResourceUri(uri);
      return await readResource(
        instrumentation,
        "agent-versions",
        resourceUri,
        async () => {
          const client = clients.forPrincipal(principal);
          const agentId = String(variables.agentId ?? "");
          const agent = await client.agents.get(agentId as never);
          if (agent.workspaceId !== principal.workspaceId) {
            throw notFound("Agent was not found.");
          }
          const versions = await client.agents.listVersions(agentId as never);
          return { agentId, versions: versions.versions };
        },
      );
    },
  );

  server.registerResource(
    "osva-workflow-versions",
    new ResourceTemplate(
      `${OSVA_MCP_RESOURCE_URI_PREFIX}/workflows/{workflowId}/versions`,
      { list: undefined },
    ),
    {
      description:
        "Immutable WorkflowVersions for a workflow in the authenticated workspace.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const resourceUri = normalizeResourceUri(uri);
      return await readResource(
        instrumentation,
        "workflow-versions",
        resourceUri,
        async () => {
          const client = clients.forPrincipal(principal);
          const workflowId = String(variables.workflowId ?? "");
          const workflow = await client.workflows.get(workflowId as never);
          if (workflow.workspaceId !== principal.workspaceId) {
            throw notFound("Workflow was not found.");
          }
          const versions = await client.workflows.listVersions(
            workflowId as never,
          );
          return { workflowId, versions: versions.versions };
        },
      );
    },
  );

  server.registerResource(
    "osva-run",
    new ResourceTemplate(`${OSVA_MCP_RESOURCE_URI_PREFIX}/runs/{runId}`, {
      list: undefined,
    }),
    {
      description: "Durable OSVA Run in the authenticated workspace.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const resourceUri = normalizeResourceUri(uri);
      return await readResource(
        instrumentation,
        "run",
        resourceUri,
        async () => {
          const client = clients.forPrincipal(principal);
          const runId = String(variables.runId ?? "");
          const run = await client.runs.get(runId as never);
          if (run.workspaceId !== principal.workspaceId) {
            throw notFound("Run was not found.");
          }
          const attempts = await client.runs.listAttempts(runId as never);
          return { run, attempts: attempts.attempts };
        },
      );
    },
  );

  server.registerResource(
    "osva-workflow-run",
    new ResourceTemplate(
      `${OSVA_MCP_RESOURCE_URI_PREFIX}/workflow-runs/{workflowRunId}`,
      { list: undefined },
    ),
    {
      description: "Durable OSVA WorkflowRun in the authenticated workspace.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const resourceUri = normalizeResourceUri(uri);
      return await readResource(
        instrumentation,
        "workflow-run",
        resourceUri,
        async () => {
          const client = clients.forPrincipal(principal);
          const workflowRunId = String(variables.workflowRunId ?? "");
          const workflowRun = await client.workflowRuns.get(
            workflowRunId as never,
          );
          if (workflowRun.workspaceId !== principal.workspaceId) {
            throw notFound("Workflow run was not found.");
          }
          return { workflowRun };
        },
      );
    },
  );
}

function normalizeResourceUri(uri: URL | string): string {
  if (typeof uri === "string") {
    return uri;
  }
  return uri.href;
}

async function readResource(
  instrumentation: OsvaInstrumentation,
  operation: string,
  resourceUri: string,
  fn: () => Promise<unknown>,
) {
  return await instrumentation.withSpan(
    OSVA_SPAN.MCP_INBOUND_RESOURCE,
    { [OSVA_ATTR.OPERATION]: operation },
    async () => {
      try {
        const payload = await fn();
        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: "application/json",
              text: JSON.stringify(payload),
            },
          ],
        };
      } catch (error) {
        if (error instanceof OsvaApiError && error.status === 404) {
          throw notFound("Resource was not found.");
        }
        throw error;
      }
    },
  );
}
