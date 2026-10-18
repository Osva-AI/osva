import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ApprovalRequestId,
  WorkflowId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva-ai/contracts";
import {
  createWorkflowRequestSchema,
  createWorkflowRunRequestSchema,
  createWorkflowVersionRequestSchema,
  decideApprovalRequestSchema,
  listWorkflowRunsQuerySchema,
  workflowListResourceSchema,
  workflowResourceSchema,
  workflowRunListResourceSchema,
  workflowRunResourceSchema,
  workflowRunSummaryResourceSchema,
  workflowVersionListResourceSchema,
  workflowVersionResourceSchema,
  approvalRequestResourceSchema,
} from "@osva-ai/contracts/schemas";
import type {
  ApprovalRequest,
  Workflow,
  WorkflowApplication,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowRunView,
  WorkflowVersion,
} from "@osva/domain";
import {
  DEFAULT_WORKFLOW_RUN_LIST_LIMIT,
  MAX_WORKFLOW_RUN_LIST_LIMIT,
} from "@osva/domain";
import {
  requireControlPlaneScope,
  requireControlPlaneWorkspaceId,
} from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";
import {
  decodeWorkflowRunListCursor,
  encodeWorkflowRunListCursor,
} from "./workflow-run-cursor.js";

export async function handleWorkflowRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  workflows: WorkflowApplication,
): Promise<boolean> {
  const route = matchWorkflowRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchWorkflowRoute(
      request,
      response,
      method,
      route,
      searchParams,
      workflows,
    );
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
  | { readonly kind: "run"; readonly workflowRunId: WorkflowRunId }
  | {
      readonly kind: "approval";
      readonly approvalRequestId: ApprovalRequestId;
    }
  | {
      readonly kind: "approvalDecision";
      readonly approvalRequestId: ApprovalRequestId;
    };

async function dispatchWorkflowRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: WorkflowRoute,
  searchParams: URLSearchParams,
  workflows: WorkflowApplication,
): Promise<void> {
  const scope = requireControlPlaneScope();
  if (route.kind === "collection") {
    if (method === "GET") {
      const list = await workflows.listWorkflows.execute(scope);
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

      const created = await workflows.createWorkflow.execute(scope, {
        ...parsed.data,
        workspaceId: requireControlPlaneWorkspaceId(),
      });
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
      const workflow = await workflows.getWorkflow.execute(
        scope,
        route.workflowId,
      );
      sendJson(response, 200, toWorkflowResource(workflow));
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "versions") {
    if (method === "GET") {
      const versions = await workflows.listWorkflowVersions.execute(
        scope,
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

      const created = await workflows.appendWorkflowVersion.execute(scope, {
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
      const version = await workflows.getWorkflowVersion.execute(scope, {
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
    if (method === "GET") {
      await handleListWorkflowRuns(response, searchParams, workflows);
      return;
    }

    if (method === "POST") {
      const parsed = createWorkflowRunRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await workflows.createWorkflowRun.execute(scope, {
        ...parsed.data,
        workspaceId: requireControlPlaneWorkspaceId(),
      });
      sendJson(
        response,
        201,
        toWorkflowRunResource({
          workflowRun: created,
          nodeRuns: [],
          approvalRequests: [],
        }),
      );
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

  if (route.kind === "approval") {
    if (method === "GET") {
      const approvalRequest = await workflows.getApprovalRequest.execute(
        scope,
        {
          workspaceId: requireControlPlaneWorkspaceId(),
          approvalRequestId: route.approvalRequestId,
        },
      );
      sendJson(response, 200, toApprovalRequestResource(approvalRequest));
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "approvalDecision") {
    if (method === "POST") {
      const parsed = decideApprovalRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const decided = await workflows.decideApprovalRequest.execute(scope, {
        workspaceId: requireControlPlaneWorkspaceId(),
        approvalRequestId: route.approvalRequestId,
        decision: parsed.data.decision,
        comment: parsed.data.comment,
      });
      sendJson(response, 200, toApprovalRequestResource(decided));
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
    const view = await workflows.getWorkflowRun.execute(
      scope,
      route.workflowRunId,
    );
    sendJson(response, 200, toWorkflowRunResource(view));
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

function matchWorkflowRoute(path: string): WorkflowRoute | undefined {
  if (path.startsWith("/v1/approval-requests/")) {
    const segments = path
      .slice("/v1/approval-requests/".length)
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));

    if (segments.length === 1 && segments[0] !== undefined) {
      return {
        kind: "approval",
        approvalRequestId: segments[0] as ApprovalRequestId,
      };
    }

    if (
      segments.length === 2 &&
      segments[0] !== undefined &&
      segments[1] === "decision"
    ) {
      return {
        kind: "approvalDecision",
        approvalRequestId: segments[0] as ApprovalRequestId,
      };
    }

    return undefined;
  }

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
    approvalRequests: view.approvalRequests.map(toApprovalRequestFields),
  });
}

function toWorkflowRunFields(workflowRun: WorkflowRun) {
  return {
    ...toWorkflowRunSummaryFields(workflowRun),
    input: workflowRun.input,
    output: workflowRun.output,
  };
}

function toWorkflowRunSummaryFields(workflowRun: WorkflowRun) {
  return {
    id: workflowRun.id,
    workspaceId: workflowRun.workspaceId,
    workflowId: workflowRun.workflowId,
    workflowVersionId: workflowRun.workflowVersionId,
    status: workflowRun.status,
    error: workflowRun.error,
    startedAt: workflowRun.startedAt?.toISOString(),
    completedAt: workflowRun.completedAt?.toISOString(),
    createdAt: workflowRun.createdAt.toISOString(),
    updatedAt: workflowRun.updatedAt.toISOString(),
  };
}

async function handleListWorkflowRuns(
  response: ServerResponse,
  searchParams: URLSearchParams,
  workflows: WorkflowApplication,
): Promise<void> {
  const scope = requireControlPlaneScope();
  const parsed = listWorkflowRunsQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  let limit = DEFAULT_WORKFLOW_RUN_LIST_LIMIT;
  if (parsed.data.limit !== undefined) {
    limit = Number(parsed.data.limit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_WORKFLOW_RUN_LIST_LIMIT
    ) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
  }

  let cursor: { createdAt: Date; id: WorkflowRunId } | undefined;
  if (parsed.data.cursor !== undefined) {
    const decoded = decodeWorkflowRunListCursor(parsed.data.cursor);
    if (decoded === null) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }

    cursor = {
      createdAt: new Date(decoded.createdAt),
      id: decoded.id as WorkflowRunId,
    };
  }

  const page = await workflows.listWorkflowRuns.execute(scope, {
    limit,
    cursor,
    workflowId: parsed.data.workflowId,
    workflowVersionId: parsed.data.workflowVersionId,
    status: parsed.data.status,
  });

  sendJson(
    response,
    200,
    toWorkflowRunListResource(page.workflowRuns, page.nextCursor),
  );
}

function toWorkflowRunListResource(
  page: readonly WorkflowRun[],
  nextCursor:
    { readonly createdAt: Date; readonly id: WorkflowRunId } | undefined,
) {
  return workflowRunListResourceSchema.parse({
    workflowRuns: page.map((workflowRun) =>
      workflowRunSummaryResourceSchema.parse(
        toWorkflowRunSummaryFields(workflowRun),
      ),
    ),
    nextCursor:
      nextCursor === undefined
        ? undefined
        : encodeWorkflowRunListCursor({
            createdAt: nextCursor.createdAt.toISOString(),
            id: nextCursor.id,
          }),
  });
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
    selectedTargetKey: nodeRun.selectedTargetKey,
    error: nodeRun.error,
    startedAt: nodeRun.startedAt?.toISOString(),
    completedAt: nodeRun.completedAt?.toISOString(),
    createdAt: nodeRun.createdAt.toISOString(),
    updatedAt: nodeRun.updatedAt.toISOString(),
  };
}

function toApprovalRequestFields(request: ApprovalRequest) {
  return {
    id: request.id,
    workspaceId: request.workspaceId,
    workflowRunId: request.workflowRunId,
    workflowNodeRunId: request.workflowNodeRunId,
    status: request.status,
    decisionComment: request.decisionComment,
    decidedAt: request.decidedAt?.toISOString(),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

function toApprovalRequestResource(request: ApprovalRequest) {
  return approvalRequestResourceSchema.parse(toApprovalRequestFields(request));
}
export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/workflows" },
  { method: "POST", path: "/v1/workflows" },
  { method: "GET", path: "/v1/workflows/:workflowId" },
  { method: "GET", path: "/v1/workflows/:workflowId/versions" },
  { method: "POST", path: "/v1/workflows/:workflowId/versions" },
  {
    method: "GET",
    path: "/v1/workflows/:workflowId/versions/:workflowVersionId",
  },
  { method: "GET", path: "/v1/workflow-runs" },
  { method: "POST", path: "/v1/workflow-runs" },
  { method: "GET", path: "/v1/workflow-runs/:workflowRunId" },
  { method: "GET", path: "/v1/approval-requests/:approvalRequestId" },
  { method: "POST", path: "/v1/approval-requests/:approvalRequestId/decision" },
] as const;
