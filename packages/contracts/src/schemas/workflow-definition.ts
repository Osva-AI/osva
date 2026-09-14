import { z } from "zod";

import {
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  WORKFLOW_NODE_TYPES,
} from "../workflow-definition.js";

const workflowNodeSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(WORKFLOW_NODE_TYPES),
  agentRef: z.string().min(1).optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
});

export const workflowDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_DEFINITION_SCHEMA_VERSION),
  key: z.string().min(1),
  name: z.string().min(1),
  nodes: z.array(workflowNodeSchema),
});
