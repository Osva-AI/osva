import { z } from "zod";

import {
  WORKFLOW_APPROVAL_DESCRIPTION_MAX_LENGTH,
  WORKFLOW_APPROVAL_TITLE_MAX_LENGTH,
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION_V2,
  WORKFLOW_DEFINITION_SCHEMA_VERSION_V3,
  WORKFLOW_EXECUTABLE_NODE_TYPES,
} from "../workflow-definition.js";
import { isValidJsonPointer } from "../json-pointer.js";
import { agentVersionIdSchema } from "./ids.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger, {
    message: "must be a safe integer",
  });

export const workflowDefinitionNodeSchema = z.strictObject({
  key: z.string().min(1),
  type: z.enum(WORKFLOW_EXECUTABLE_NODE_TYPES),
  agentVersionId: agentVersionIdSchema,
});

export const workflowDefinitionEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const workflowDefinitionV1Schema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_DEFINITION_SCHEMA_VERSION),
  nodes: z.array(workflowDefinitionNodeSchema),
  edges: z.array(workflowDefinitionEdgeSchema),
});

const workflowBranchEqualsSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const workflowDefinitionBranchCaseSchema = z.strictObject({
  equals: workflowBranchEqualsSchema,
  to: z.string().min(1),
});

export const workflowDefinitionAgentNodeV2Schema = z.strictObject({
  key: z.string().min(1),
  type: z.literal("AGENT"),
  agentVersionId: agentVersionIdSchema,
});

export const workflowDefinitionBranchNodeV2Schema = z.strictObject({
  key: z.string().min(1),
  type: z.literal("BRANCH"),
  selector: z.string().refine(isValidJsonPointer, {
    message: "BRANCH selector must be a valid JSON Pointer.",
  }),
  cases: z.array(workflowDefinitionBranchCaseSchema),
  defaultTo: z.string().min(1),
});

export const workflowDefinitionParallelNodeV2Schema = z.strictObject({
  key: z.string().min(1),
  type: z.literal("PARALLEL"),
});

export const workflowDefinitionJoinNodeV2Schema = z.strictObject({
  key: z.string().min(1),
  type: z.literal("JOIN"),
});

export const workflowDefinitionApprovalNodeV2Schema = z.strictObject({
  key: z.string().min(1),
  type: z.literal("APPROVAL"),
  title: z.string().min(1).max(WORKFLOW_APPROVAL_TITLE_MAX_LENGTH),
  description: z
    .string()
    .min(1)
    .max(WORKFLOW_APPROVAL_DESCRIPTION_MAX_LENGTH)
    .optional(),
});

export const workflowDefinitionV2NodeSchema = z.discriminatedUnion("type", [
  workflowDefinitionAgentNodeV2Schema,
  workflowDefinitionBranchNodeV2Schema,
  workflowDefinitionParallelNodeV2Schema,
  workflowDefinitionJoinNodeV2Schema,
  workflowDefinitionApprovalNodeV2Schema,
]);

export const workflowDefinitionV2Schema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_DEFINITION_SCHEMA_VERSION_V2),
  nodes: z.array(workflowDefinitionV2NodeSchema),
  edges: z.array(workflowDefinitionEdgeSchema),
});

export const workflowWaitCorrelationLiteralSchema = z.strictObject({
  kind: z.literal("LITERAL"),
  value: z.string().min(1),
});

export const workflowWaitCorrelationInputPointerSchema = z.strictObject({
  kind: z.literal("INPUT_POINTER"),
  pointer: z.string().refine(isValidJsonPointer, {
    message: "INPUT_POINTER must be a valid JSON Pointer.",
  }),
});

export const workflowWaitCorrelationSchema = z.discriminatedUnion("kind", [
  workflowWaitCorrelationLiteralSchema,
  workflowWaitCorrelationInputPointerSchema,
]);

export const workflowWaitDurationSchema = z.strictObject({
  kind: z.literal("DURATION"),
  durationMs: positiveSafeIntegerSchema,
});

export const workflowWaitUntilSchema = z.strictObject({
  kind: z.literal("UNTIL"),
  until: utcIso8601TimestampSchema,
});

export const workflowWaitEventSchema = z.strictObject({
  kind: z.literal("EVENT"),
  source: z.string().min(1),
  eventType: z.string().min(1),
  correlation: workflowWaitCorrelationSchema,
  timeoutMs: positiveSafeIntegerSchema.optional(),
});

export const workflowWaitConfigurationSchema = z.discriminatedUnion("kind", [
  workflowWaitDurationSchema,
  workflowWaitUntilSchema,
  workflowWaitEventSchema,
]);

export const workflowDefinitionWaitNodeV3Schema = z.strictObject({
  key: z.string().min(1),
  type: z.literal("WAIT"),
  wait: workflowWaitConfigurationSchema,
});

export const workflowDefinitionV3NodeSchema = z.discriminatedUnion("type", [
  workflowDefinitionAgentNodeV2Schema,
  workflowDefinitionBranchNodeV2Schema,
  workflowDefinitionParallelNodeV2Schema,
  workflowDefinitionJoinNodeV2Schema,
  workflowDefinitionApprovalNodeV2Schema,
  workflowDefinitionWaitNodeV3Schema,
]);

export const workflowDefinitionV3Schema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_DEFINITION_SCHEMA_VERSION_V3),
  nodes: z.array(workflowDefinitionV3NodeSchema),
  edges: z.array(workflowDefinitionEdgeSchema),
});

export const workflowDefinitionSchema = z.discriminatedUnion("schemaVersion", [
  workflowDefinitionV1Schema,
  workflowDefinitionV2Schema,
  workflowDefinitionV3Schema,
]);
