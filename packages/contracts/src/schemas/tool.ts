import { z } from "zod";

import {
  runIdSchema,
  runStepIdSchema,
  toolIdSchema,
  toolVersionIdSchema,
  workflowNodeRunIdSchema,
  workflowRunIdSchema,
} from "./ids.js";

export const toolGrantSchema = z.strictObject({
  toolId: toolIdSchema,
});

export const toolInvocationSchema = z.strictObject({
  toolVersionId: toolVersionIdSchema,
  input: z.unknown(),
  operationId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  runId: runIdSchema.optional(),
  runStepId: runStepIdSchema.optional(),
  workflowRunId: workflowRunIdSchema.optional(),
  workflowNodeRunId: workflowNodeRunIdSchema.optional(),
});
