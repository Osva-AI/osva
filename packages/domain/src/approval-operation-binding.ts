import {
  APPROVAL_OPERATION_BINDING_SCHEMA_VERSION,
  APPROVAL_OPERATION_KINDS,
  type ApprovalDecision,
  type ApprovalOperationBinding,
  type ApprovalOperationKind,
  type JsonValue,
  type ToolInvocationApprovalBindingContext,
  type WorkflowNodeApprovalBindingContext,
} from "@osva-ai/contracts";

import type { ApprovalRequest } from "./approval-request.js";
import {
  ApprovalExpiredError,
  ApprovalOperationMismatchError,
} from "./errors.js";
import {
  canonicalJsonStringify,
  digestCanonicalJsonValue,
} from "./json-equality.js";
import type { WorkflowNodeRun } from "./workflow-node-run.js";
import { createHash } from "node:crypto";

export function buildWorkflowNodeProgressionBinding(
  context: WorkflowNodeApprovalBindingContext,
): ApprovalOperationBinding {
  return {
    schemaVersion: APPROVAL_OPERATION_BINDING_SCHEMA_VERSION,
    kind: APPROVAL_OPERATION_KINDS.WORKFLOW_NODE_PROGRESSION,
    workspaceId: context.workspaceId,
    workflowRunId: context.workflowRunId,
    workflowNodeRunId: context.workflowNodeRunId,
    inputDigest: digestCanonicalJsonValue(context.nodeInput),
  };
}

export function buildToolInvocationBinding(
  context: ToolInvocationApprovalBindingContext,
): ApprovalOperationBinding {
  return {
    schemaVersion: APPROVAL_OPERATION_BINDING_SCHEMA_VERSION,
    kind: APPROVAL_OPERATION_KINDS.TOOL_INVOCATION,
    workspaceId: context.workspaceId,
    workflowRunId: context.workflowRunId,
    runId: context.runId,
    runAttemptId: context.runAttemptId,
    bindingName: context.bindingName,
    toolVersionId: context.toolVersionId,
    argumentsDigest: digestCanonicalJsonValue(context.arguments),
  };
}

export function digestApprovalOperationBinding(
  binding: ApprovalOperationBinding,
): string {
  const payload = canonicalJsonStringify(binding as unknown as JsonValue);
  const digest = createHash("sha256").update(payload, "utf8").digest("hex");
  return `sha256:${digest}`;
}

export function recomputeWorkflowNodeProgressionDigest(
  nodeRun: WorkflowNodeRun,
): string {
  return digestApprovalOperationBinding(
    buildWorkflowNodeProgressionBinding({
      workspaceId: nodeRun.workspaceId,
      workflowRunId: nodeRun.workflowRunId,
      workflowNodeRunId: nodeRun.id,
      nodeInput: nodeRun.input as JsonValue,
    }),
  );
}

export function assertApprovalNotExpired(
  request: ApprovalRequest,
  now: Date,
): void {
  if (
    request.expiresAt !== undefined &&
    now.getTime() > request.expiresAt.getTime()
  ) {
    throw new ApprovalExpiredError(request.id);
  }
}

export function assertWorkflowNodeApprovalBinding(
  request: ApprovalRequest,
  nodeRun: WorkflowNodeRun,
): void {
  if (
    request.operationKind === undefined ||
    request.operationDigest === undefined
  ) {
    return;
  }

  if (
    request.operationKind !== APPROVAL_OPERATION_KINDS.WORKFLOW_NODE_PROGRESSION
  ) {
    throw new ApprovalOperationMismatchError(request.id);
  }

  if (
    request.workspaceId !== nodeRun.workspaceId ||
    request.workflowRunId !== nodeRun.workflowRunId ||
    request.workflowNodeRunId !== nodeRun.id
  ) {
    throw new ApprovalOperationMismatchError(request.id);
  }

  const expectedDigest = recomputeWorkflowNodeProgressionDigest(nodeRun);
  if (request.operationDigest !== expectedDigest) {
    throw new ApprovalOperationMismatchError(request.id);
  }
}

export function assertApprovalDecisionAuthorizesOperation(input: {
  readonly request: ApprovalRequest;
  readonly nodeRun: WorkflowNodeRun;
  readonly decision: ApprovalDecision;
  readonly now: Date;
}): void {
  if (input.decision === "REJECTED") {
    return;
  }

  assertApprovalNotExpired(input.request, input.now);
  assertWorkflowNodeApprovalBinding(input.request, input.nodeRun);
}

export function assertToolInvocationMatchesApprovalBinding(input: {
  readonly operationKind: ApprovalOperationKind | undefined;
  readonly operationDigest: string | undefined;
  readonly context: ToolInvocationApprovalBindingContext;
}): void {
  if (
    input.operationKind === undefined ||
    input.operationDigest === undefined
  ) {
    throw new ApprovalOperationMismatchError(undefined);
  }

  if (input.operationKind !== APPROVAL_OPERATION_KINDS.TOOL_INVOCATION) {
    throw new ApprovalOperationMismatchError(undefined);
  }

  const expectedDigest = digestApprovalOperationBinding(
    buildToolInvocationBinding(input.context),
  );
  if (input.operationDigest !== expectedDigest) {
    throw new ApprovalOperationMismatchError(undefined);
  }
}
