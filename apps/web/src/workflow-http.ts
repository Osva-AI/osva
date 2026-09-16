import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  WorkflowId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva/contracts";
import {
  createWorkflowRequestSchema,
  createWorkflowRunRequestSchema,
  createWorkflowVersionRequestSchema,
  workflowListResourceSchema,
  workflowResourceSchema,
  workflowRunResourceSchema,
  workflowVersionListResourceSchema,
  workflowVersionResourceSchema,
} from "@osva/contracts/schemas";
import type {
  Workflow,
  WorkflowApplication,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowRunView,
  WorkflowVersion,
} from "@osva/domain";

import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export async function handleWorkflowRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  workflows: WorkflowApplication,
): Promise<boolean> {
  const route = matchWorkflowRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchWorkflowRoute(request, response, method, route, workflows);
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type WorkflowRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly workflowId: WorkflowId }
  | { readonly kind: "versions"; readonly workflowId: WorkflowId }
  | {
      readonly kind: "version";
      readonly workflowId: WorkflowId;
      readonly workflowVersionId: WorkflowVersionId;
    }
  | { readonly kind: "runs" }
  | { readonly kind: "run"; readonly workflowRunId: WorkflowRunId };

async function dispatchWorkflowRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: WorkflowRoute,
  workflows: WorkflowApplication,
): Promise<void> {
  if (route.kind === "collection") {
    if (method === "GET") {
      const list = await workflows.listWorkflows.execute();
      sendJson(response, 200, toWorkflowListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createWorkflowRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await workflows.createWorkflow.execute(parsed.data);
      sendJson(response, 201, toWorkflowResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "item") {
    if (method === "GET") {
      const workflow = await workflows.getWorkflow.execute(route.workflowId);
      sendJson(response, 200, toWorkflowResource(workflow));
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "versions") {
    if (method === "GET") {
      const versions = await workflows.listWorkflowVersions.execute(
        route.workflowId,
      );
      sendJson(response, 200, toWorkflowVersionListResource(versions));
      return;
    }

    if (method === "POST") {
      const parsed = createWorkflowVersionRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await workflows.appendWorkflowVersion.execute({
        workflowId: route.workflowId,
        definition: parsed.data.definition,
      });
      sendJson(response, 201, toWorkflowVersionResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "version") {
    if (method === "GET") {
      const version = await workflows.getWorkflowVersion.execute({
        workflowId: route.workflowId,
        workflowVersionId: route.workflowVersionId,
      });
      sendJson(response, 200, toWorkflowVersionResource(version));
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "runs") {
    if (method === "POST") {
      const parsed = createWorkflowRunRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await workflows.createWorkflowRun.execute(parsed.data);
      sendJson(
        response,
        201,
        toWorkflowRunResource({ workflowRun: created, nodeRuns: [] }),
      );
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "POST" },
    );
    return;
  }

  if (method === "GET") {
    const view = await workflows.getWorkflowRun.execute(route.workflowRunId);
    sendJson(response, 200, toWorkflowRunResource(view));
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

function matchWorkflowRoute(path: string): WorkflowRoute | undefined {
  if (path === "/v1/workflow-runs" || path === "/v1/workflow-runs/") {
    return { kind: "runs" };
  }

  if (path.startsWith("/v1/workflow-runs/")) {
    const segments = path
      .slice("/v1/workflow-runs/".length)
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));

    if (segments.length === 1 && segments[0] !== undefined) {
      return { kind: "run", workflowRunId: segments[0] as WorkflowRunId };
    }

    return undefined;
  }

  if (path === "/v1/workflows" || path === "/v1/workflows/") {
    return { kind: "collection" };
  }

  if (!path.startsWith("/v1/workflows/")) {
    return undefined;
  }

  const segments = path
    .slice("/v1/workflows/".length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length === 1 && segments[0] !== undefined) {
    return { kind: "item", workflowId: segments[0] as WorkflowId };
  }

  if (
    segments.length === 2 &&
    segments[0] !== undefined &&
    segments[1] === "versions"
  ) {
    return { kind: "versions", workflowId: segments[0] as WorkflowId };
  }

  if (
    segments.length === 3 &&
    segments[0] !== undefined &&
    segments[1] === "versions" &&
    segments[2] !== undefined
  ) {
    return {
      kind: "version",
      workflowId: segments[0] as WorkflowId,
      workflowVersionId: segments[2] as WorkflowVersionId,
    };
  }

  return undefined;
}

function toWorkflowResource(workflow: Workflow) {
  return workflowResourceSchema.parse({
    id: workflow.id,
    workspaceId: workflow.workspaceId,
    key: workflow.key,
    name: workflow.name,
    description: workflow.description,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  });
}

function toWorkflowListResource(workflows: readonly Workflow[]) {
  return workflowListResourceSchema.parse({
    workflows: workflows.map((workflow) => ({
      id: workflow.id,
      workspaceId: workflow.workspaceId,
      key: workflow.key,
      name: workflow.name,
      description: workflow.description,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    })),
  });
}

function toWorkflowVersionResource(version: WorkflowVersion) {
  return workflowVersionResourceSchema.parse({
    id: version.id,
    workflowId: version.workflowId,
    workspaceId: version.workspaceId,
    version: version.version,
    definition: version.definition,
    createdAt: version.createdAt.toISOString(),
  });
}

function toWorkflowVersionListResource(versions: readonly WorkflowVersion[]) {
  return workflowVersionListResourceSchema.parse({
    versions: versions.map((version) => ({
      id: version.id,
      workflowId: version.workflowId,
      workspaceId: version.workspaceId,
      version: version.version,
      definition: version.definition,
      createdAt: version.createdAt.toISOString(),
    })),
  });
}

function toWorkflowRunResource(view: WorkflowRunView) {
  return workflowRunResourceSchema.parse({
    ...toWorkflowRunFields(view.workflowRun),
    nodeRuns: view.nodeRuns.map(toWorkflowNodeRunFields),
  });
}

function toWorkflowRunFields(workflowRun: WorkflowRun) {
  return {
    id: workflowRun.id,
    workspaceId: workflowRun.workspaceId,
    workflowId: workflowRun.workflowId,
    workflowVersionId: workflowRun.workflowVersionId,
    status: workflowRun.status,
    input: workflowRun.input,
    output: workflowRun.output,
    error: workflowRun.error,
    startedAt: workflowRun.startedAt?.toISOString(),
    completedAt: workflowRun.completedAt?.toISOString(),
    createdAt: workflowRun.createdAt.toISOString(),
    updatedAt: workflowRun.updatedAt.toISOString(),
  };
}

function toWorkflowNodeRunFields(nodeRun: WorkflowNodeRun) {
  return {
    id: nodeRun.id,
    workspaceId: nodeRun.workspaceId,
    workflowRunId: nodeRun.workflowRunId,
    workflowNodeKey: nodeRun.workflowNodeKey,
    sequence: nodeRun.sequence,
    status: nodeRun.status,
    input: nodeRun.input,
    output: nodeRun.output,
    childRunId: nodeRun.childRunId,
    error: nodeRun.error,
    startedAt: nodeRun.startedAt?.toISOString(),
    completedAt: nodeRun.completedAt?.toISOString(),
    createdAt: nodeRun.createdAt.toISOString(),
    updatedAt: nodeRun.updatedAt.toISOString(),
  };
}
