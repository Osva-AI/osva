import { z } from "zod";

import {
  agentIdSchema,
  agentVersionIdSchema,
  runIdSchema,
  workflowRunIdSchema,
  workflowVersionIdSchema,
} from "./ids.js";

function rejectWorkspaceIdOverride(value: unknown, ctx: z.RefinementCtx): void {
  if (value !== null && typeof value === "object" && "workspaceId" in value) {
    ctx.addIssue({
      code: "custom",
      message: "workspaceId must not be supplied in MCP tool arguments.",
    });
  }
}

export const osvaMcpAgentRunV1InputSchema = z
  .strictObject({
    agentId: agentIdSchema,
    agentVersionId: agentVersionIdSchema,
    input: z.unknown(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .superRefine(rejectWorkspaceIdOverride);

export const osvaMcpRunGetV1InputSchema = z
  .strictObject({
    runId: runIdSchema,
  })
  .superRefine(rejectWorkspaceIdOverride);

export const osvaMcpWorkflowRunV1InputSchema = z
  .strictObject({
    workflowVersionId: workflowVersionIdSchema,
    input: z.unknown(),
  })
  .superRefine(rejectWorkspaceIdOverride);

export const osvaMcpWorkflowRunGetV1InputSchema = z
  .strictObject({
    workflowRunId: workflowRunIdSchema,
  })
  .superRefine(rejectWorkspaceIdOverride);
