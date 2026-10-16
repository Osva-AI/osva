import { z } from "zod";

import {
  AGENT_EXECUTION_MAX_TIMEOUT_MS,
  AGENT_EXECUTION_MIN_TIMEOUT_MS,
} from "@osva-ai/contracts";

export const osvaAgentProjectSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  key: z.string().min(1),
  name: z.string().min(1),
  runtime: z.strictObject({
    type: z.literal("TRUSTED_TYPESCRIPT"),
    entrypoint: z.string().min(1),
  }),
  execution: z.strictObject({
    timeoutMs: z
      .int()
      .min(AGENT_EXECUTION_MIN_TIMEOUT_MS)
      .max(AGENT_EXECUTION_MAX_TIMEOUT_MS),
    maxAttempts: z.int().min(1),
  }),
  capabilities: z.strictObject({
    model: z.boolean(),
    tools: z.array(z.string().min(1)),
  }),
  contracts: z.strictObject({
    input: z.string().min(1),
    output: z.string().min(1),
  }),
});

export type OsvaAgentProject = z.infer<typeof osvaAgentProjectSchema>;
