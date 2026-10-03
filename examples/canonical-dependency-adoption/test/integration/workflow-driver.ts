import type { WorkflowRunId } from "@osva-ai/contracts";
import { expect } from "vitest";

import { fetchJson } from "../../../../apps/worker/test/integration/integration-auth.js";
import {
  buildDeliveryEventRequest,
  deliveryEventIdempotencyKey,
} from "../../scripts/lib/args.js";
import type { CanonicalStack } from "./canonical-stack.js";
import { delay, waitUntil } from "./canonical-stack.js";

export interface WorkflowRunView {
  readonly status: string;
  readonly error?: { readonly code?: string };
  readonly nodeRuns: ReadonlyArray<{
    readonly workflowNodeKey: string;
    readonly status: string;
    readonly childRunId?: string;
    readonly error?: { readonly code?: string };
  }>;
  readonly approvalRequests: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
  }>;
}

export async function loadWorkflowRun(
  origin: string,
  workflowRunId: WorkflowRunId,
): Promise<WorkflowRunView> {
  const response = await fetchJson(
    `${origin}/v1/workflow-runs/${workflowRunId}`,
  );
  if (response.status !== 200) {
    throw new Error(
      `Failed to load workflow run (${String(response.status)}).`,
    );
  }
  return response.body as WorkflowRunView;
}

export function nodeByKey(
  view: WorkflowRunView,
): Record<string, WorkflowRunView["nodeRuns"][number]> {
  return Object.fromEntries(
    view.nodeRuns.map((node) => [node.workflowNodeKey, node]),
  );
}

export async function createCanonicalWorkflowRun(
  stack: CanonicalStack,
  workflowInput: unknown,
): Promise<WorkflowRunId> {
  const created = await fetchJson(`${stack.origin}/v1/workflow-runs`, {
    method: "POST",
    body: {
      workflowVersionId: stack.seed.workflowVersionId,
      input: workflowInput,
    },
  });
  expect(created.status).toBe(201);
  return (created.body as { id: string }).id as WorkflowRunId;
}

export async function driveUntilApprovalWaiting(
  stack: CanonicalStack,
  workflowRunId: WorkflowRunId,
): Promise<WorkflowRunView> {
  await waitUntil(async () => {
    await stack.tickOrchestrator();
    const view = await loadWorkflowRun(stack.origin, workflowRunId);
    if (view.status === "FAILED") {
      throw new Error(
        `WorkflowRun failed before approval: ${JSON.stringify(view.error ?? {})}`,
      );
    }
    const nodes = nodeByKey(view);
    return (
      view.status === "WAITING" &&
      nodes["adoption-approval"]?.status === "WAITING" &&
      view.approvalRequests.length === 1 &&
      view.approvalRequests[0]?.status === "PENDING"
    );
  });
  return loadWorkflowRun(stack.origin, workflowRunId);
}

export async function approveWorkflow(
  stack: CanonicalStack,
  approvalRequestId: string,
): Promise<void> {
  const decision = await fetchJson(
    `${stack.origin}/v1/approval-requests/${approvalRequestId}/decision`,
    {
      method: "POST",
      body: {
        decision: "APPROVED",
        comment: "Approved in M6 integration test.",
      },
    },
  );
  expect(decision.status).toBe(200);
}

export async function rejectWorkflow(
  stack: CanonicalStack,
  approvalRequestId: string,
): Promise<void> {
  const decision = await fetchJson(
    `${stack.origin}/v1/approval-requests/${approvalRequestId}/decision`,
    {
      method: "POST",
      body: {
        decision: "REJECTED",
        comment: "Rejected in M6 integration test.",
      },
    },
  );
  expect(decision.status).toBe(200);
}

export async function emitDeliveryEvent(
  stack: CanonicalStack,
  requestId: string,
  idempotencyKey?: string,
): Promise<{ readonly eventId: string; readonly body: unknown }> {
  const body = buildDeliveryEventRequest(requestId);
  const payload =
    idempotencyKey === undefined ? body : { ...body, idempotencyKey };
  const ingested = await fetchJson(`${stack.origin}/v1/workflow-events`, {
    method: "POST",
    body: payload,
  });
  expect(ingested.status).toBe(200);
  return {
    eventId: (ingested.body as { id: string }).id,
    body: ingested.body,
  };
}

export async function driveUntilTerminal(
  stack: CanonicalStack,
  workflowRunId: WorkflowRunId,
  expected: "SUCCEEDED" | "FAILED",
): Promise<WorkflowRunView> {
  await waitUntil(async () => {
    await stack.tickOrchestrator();
    const view = await loadWorkflowRun(stack.origin, workflowRunId);
    return view.status === expected;
  });
  return loadWorkflowRun(stack.origin, workflowRunId);
}

export async function driveHappyPathAfterApproval(
  stack: CanonicalStack,
  workflowRunId: WorkflowRunId,
  requestId: string,
  options?: { readonly skipDeliveryEvent?: boolean },
): Promise<WorkflowRunView> {
  const waiting = await loadWorkflowRun(stack.origin, workflowRunId);
  await approveWorkflow(stack, waiting.approvalRequests[0]!.id);
  if (options?.skipDeliveryEvent !== true) {
    await emitDeliveryEvent(stack, requestId);
  }
  return driveUntilTerminal(stack, workflowRunId, "SUCCEEDED");
}

export async function driveFullHappyPath(
  stack: CanonicalStack,
  workflowRunId: WorkflowRunId,
  requestId: string,
): Promise<WorkflowRunView> {
  await driveUntilApprovalWaiting(stack, workflowRunId);
  return driveHappyPathAfterApproval(stack, workflowRunId, requestId);
}

export { deliveryEventIdempotencyKey, delay };
