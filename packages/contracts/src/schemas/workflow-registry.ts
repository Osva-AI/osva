import { z } from "zod";

import { jsonValueSchema } from "./json-value.js";
import {
  approvalRequestIdSchema,
  workflowIdSchema,
  workflowNodeRunIdSchema,
  workflowRunIdSchema,
  workflowVersionIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";
import { workflowDefinitionSchema } from "./workflow-definition.js";
import { APPROVAL_DECISION_COMMENT_MAX_LENGTH } from "../approval.js";

export const workflowRunStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export const workflowNodeRunStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
]);

export const approvalRequestStateSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const approvalDecisionSchema = z.enum(["APPROVED", "REJECTED"]);

export const createWorkflowRequestSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const createWorkflowVersionRequestSchema = z.strictObject({
  definition: workflowDefinitionSchema,
});

export const createWorkflowRunRequestSchema = z.strictObject({
  workflowVersionId: workflowVersionIdSchema,
  input: jsonValueSchema,
});

export const workflowResourceSchema = z.strictObject({
  id: workflowIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  createdAt: utcIso8601TimestampSchema,
  updatedAt: utcIso8601TimestampSchema,
});

export const workflowVersionResourceSchema = z.strictObject({
  id: workflowVersionIdSchema,
  workflowId: workflowIdSchema,
  workspaceId: workspaceIdSchema,
  version: z.int().positive(),
  definition: workflowDefinitionSchema,
  createdAt: utcIso8601TimestampSchema,
});

export const workflowListResourceSchema = z.strictObject({
  workflows: z.array(workflowResourceSchema),
});

export const workflowVersionListResourceSchema = z.strictObject({
  versions: z.array(workflowVersionResourceSchema),
});

export const workflowRunErrorResourceSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const workflowNodeRunResourceSchema = z.strictObject({
  id: workflowNodeRunIdSchema,
  workspaceId: workspaceIdSchema,
  workflowRunId: workflowRunIdSchema,
  workflowNodeKey: z.string().min(1),
  sequence: z.int().positive(),
  status: workflowNodeRunStateSchema,
  input: jsonValueSchema,
  output: jsonValueSchema.optional(),
  childRunId: z.string().min(1).optional(),
  selectedTargetKey: z.string().min(1).optional(),
  error: workflowRunErrorResourceSchema.optional(),
  startedAt: utcIso8601TimestampSchema.optional(),
  completedAt: utcIso8601TimestampSchema.optional(),
  createdAt: utcIso8601TimestampSchema,
  updatedAt: utcIso8601TimestampSchema,
});

export const approvalRequestResourceSchema = z.strictObject({
  id: approvalRequestIdSchema,
  workspaceId: workspaceIdSchema,
  workflowRunId: workflowRunIdSchema,
  workflowNodeRunId: workflowNodeRunIdSchema,
  status: approvalRequestStateSchema,
  decisionComment: z
    .string()
    .min(1)
    .max(APPROVAL_DECISION_COMMENT_MAX_LENGTH)
    .optional(),
  decidedAt: utcIso8601TimestampSchema.optional(),
  createdAt: utcIso8601TimestampSchema,
  updatedAt: utcIso8601TimestampSchema,
});

export const workflowRunResourceSchema = z.strictObject({
  id: workflowRunIdSchema,
  workspaceId: workspaceIdSchema,
  workflowId: workflowIdSchema,
  workflowVersionId: workflowVersionIdSchema,
  status: workflowRunStateSchema,
  input: jsonValueSchema,
  output: jsonValueSchema.optional(),
  error: workflowRunErrorResourceSchema.optional(),
  startedAt: utcIso8601TimestampSchema.optional(),
  completedAt: utcIso8601TimestampSchema.optional(),
  createdAt: utcIso8601TimestampSchema,
  updatedAt: utcIso8601TimestampSchema,
  nodeRuns: z.array(workflowNodeRunResourceSchema),
  approvalRequests: z.array(approvalRequestResourceSchema),
});

export const decideApprovalRequestSchema = z.strictObject({
  decision: approvalDecisionSchema,
  comment: z
    .string()
    .min(1)
    .max(APPROVAL_DECISION_COMMENT_MAX_LENGTH)
    .optional(),
});
