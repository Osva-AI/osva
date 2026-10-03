import type { ApprovalRequestId, WorkflowRunId } from "@osva-ai/contracts";
import { decideApprovalRequestSchema } from "@osva-ai/contracts/schemas";
import { OsvaApiError } from "@osva-ai/sdk";

import {
  buildDeliveryEventRequest,
  extractRequestIdFromWorkflowInput,
} from "../scripts/lib/args.js";
import type { OperatorApi } from "../scripts/lib/operator-client.js";
import {
  ApprovalCommandError,
  indexNodeRuns,
  selectPendingApprovalForDecision,
} from "../scripts/lib/workflow-status.js";

export interface ApprovalMutationBody {
  readonly approvalId: string;
  readonly decision: "APPROVED" | "REJECTED";
  readonly comment?: string;
}

export class DemoOperatorMutationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DemoOperatorMutationError";
    this.status = status;
  }
}

export function parseApprovalMutationBody(
  body: unknown,
): ApprovalMutationBody | DemoOperatorMutationError {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return new DemoOperatorMutationError("Invalid approval request body.", 400);
  }
  const record = body as Record<string, unknown>;
  const approvalId = record.approvalId;
  if (typeof approvalId !== "string" || approvalId.trim().length === 0) {
    return new DemoOperatorMutationError("approvalId is required.", 400);
  }
  const decision = record.decision;
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return new DemoOperatorMutationError(
      "decision must be APPROVED or REJECTED.",
      400,
    );
  }
  let comment: string | undefined;
  if (record.comment !== undefined) {
    if (typeof record.comment !== "string" || record.comment.length === 0) {
      return new DemoOperatorMutationError(
        "comment must be a non-empty string when provided.",
        400,
      );
    }
    comment = record.comment;
  }

  const decisionPayload = decideApprovalRequestSchema.safeParse({
    decision,
    ...(comment === undefined ? {} : { comment }),
  });
  if (!decisionPayload.success) {
    return new DemoOperatorMutationError(
      decisionPayload.error.issues[0]?.message ??
        "Invalid approval decision payload.",
      400,
    );
  }

  return {
    approvalId: approvalId.trim(),
    decision,
    ...(comment === undefined ? {} : { comment }),
  };
}

export interface ApprovalMutationResult {
  readonly approvalId: ApprovalRequestId;
  readonly status: string;
  readonly decision: "APPROVED" | "REJECTED";
}

export async function executeApprovalMutation(
  api: OperatorApi,
  workflowRunId: WorkflowRunId,
  input: ApprovalMutationBody,
): Promise<ApprovalMutationResult> {
  let run;
  try {
    run = await api.sdk.workflowRuns.get(workflowRunId);
  } catch (error) {
    if (error instanceof OsvaApiError && error.status === 404) {
      throw new DemoOperatorMutationError("Workflow run not found.", 404);
    }
    throw error;
  }

  if (run.id !== workflowRunId) {
    throw new DemoOperatorMutationError("Workflow run not found.", 404);
  }

  let pending;
  try {
    pending = selectPendingApprovalForDecision(run);
  } catch (error) {
    if (error instanceof ApprovalCommandError) {
      throw new DemoOperatorMutationError(error.message, 409);
    }
    throw error;
  }

  if (pending.id !== input.approvalId) {
    throw new DemoOperatorMutationError(
      "Approval request id does not match the pending approval for this workflow run.",
      400,
    );
  }

  const decidePayload = decideApprovalRequestSchema.parse({
    decision: input.decision,
    ...(input.comment === undefined ? {} : { comment: input.comment }),
  });

  let updated;
  try {
    updated = await api.sdk.approvals.decide(
      pending.id as ApprovalRequestId,
      decidePayload,
    );
  } catch (error) {
    if (error instanceof OsvaApiError) {
      throw new DemoOperatorMutationError(
        error.message.length > 0 ? error.message : "Approval decision failed.",
        error.status >= 400 && error.status < 600 ? error.status : 502,
      );
    }
    throw error;
  }

  return {
    approvalId: updated.id,
    status: updated.status,
    decision: input.decision,
  };
}

export interface DeliveryEventMutationResult {
  readonly requestId: string;
  readonly eventId: string;
  readonly source: string;
  readonly eventType: string;
}

export async function executeDeliveryEventMutation(
  api: OperatorApi,
  workflowRunId: WorkflowRunId,
): Promise<DeliveryEventMutationResult> {
  let run;
  try {
    run = await api.sdk.workflowRuns.get(workflowRunId);
  } catch (error) {
    if (error instanceof OsvaApiError && error.status === 404) {
      throw new DemoOperatorMutationError("Workflow run not found.", 404);
    }
    throw error;
  }

  if (run.id !== workflowRunId) {
    throw new DemoOperatorMutationError("Workflow run not found.", 404);
  }

  const requestId = extractRequestIdFromWorkflowInput(run.input);
  if (requestId === null) {
    throw new DemoOperatorMutationError(
      "Could not resolve requestId from workflow run input.",
      400,
    );
  }

  const deliveryNode = indexNodeRuns(run).get("delivery-wait");
  if (deliveryNode?.status !== "WAITING") {
    throw new DemoOperatorMutationError(
      "Delivery event can only be emitted while the delivery wait node is WAITING.",
      409,
    );
  }

  const body = buildDeliveryEventRequest(requestId);
  const event = await api.ingestWorkflowEvent(body);

  return {
    requestId,
    eventId: event.id,
    source: event.source,
    eventType: event.eventType,
  };
}
