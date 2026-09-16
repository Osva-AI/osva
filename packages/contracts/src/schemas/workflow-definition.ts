import { z } from "zod";

import {
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION_V2,
  WORKFLOW_EXECUTABLE_NODE_TYPES,
} from "../workflow-definition.js";
import { isValidJsonPointer } from "../json-pointer.js";
import { agentVersionIdSchema } from "./ids.js";

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

export const workflowDefinitionV2NodeSchema = z.discriminatedUnion("type", [
  workflowDefinitionAgentNodeV2Schema,
  workflowDefinitionBranchNodeV2Schema,
  workflowDefinitionParallelNodeV2Schema,
  workflowDefinitionJoinNodeV2Schema,
]);

export const workflowDefinitionV2Schema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_DEFINITION_SCHEMA_VERSION_V2),
  nodes: z.array(workflowDefinitionV2NodeSchema),
  edges: z.array(workflowDefinitionEdgeSchema),
});

export const workflowDefinitionSchema = z.discriminatedUnion("schemaVersion", [
  workflowDefinitionV1Schema,
  workflowDefinitionV2Schema,
]);
