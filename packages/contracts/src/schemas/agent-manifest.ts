import { z } from "zod";

import {
  AGENT_MANIFEST_SCHEMA_VERSION,
  AGENT_RUNTIME_TYPES,
} from "../agent-manifest.js";
import { jsonSchemaRecordSchema } from "./json-schema.js";

const agentRuntimeSchema = z.strictObject({
  type: z.enum(AGENT_RUNTIME_TYPES),
  key: z.string().min(1),
});

const agentManifestIoSchema = z.strictObject({
  schema: jsonSchemaRecordSchema,
});

const agentManifestExecutionSchema = z.strictObject({
  timeoutMs: z.int().positive(),
  maxAttempts: z.int().min(1),
});

const agentManifestCapabilitiesSchema = z.strictObject({
  model: z.boolean(),
  tools: z.array(z.string().min(1)),
});

export const agentManifestSchema = z.strictObject({
  schemaVersion: z.literal(AGENT_MANIFEST_SCHEMA_VERSION),
  key: z.string().min(1),
  name: z.string().min(1),
  runtime: agentRuntimeSchema,
  input: agentManifestIoSchema,
  output: agentManifestIoSchema,
  execution: agentManifestExecutionSchema,
  capabilities: agentManifestCapabilitiesSchema,
});
