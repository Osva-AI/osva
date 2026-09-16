import { z } from "zod";

import {
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  WORKFLOW_EXECUTABLE_NODE_TYPES,
} from "../workflow-definition.js";
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

export const workflowDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_DEFINITION_SCHEMA_VERSION),
  nodes: z.array(workflowDefinitionNodeSchema),
  edges: z.array(workflowDefinitionEdgeSchema),
});
