import { z } from "zod";

import {
  AGENT_EXECUTION_MAX_TIMEOUT_MS,
  AGENT_EXECUTION_MIN_TIMEOUT_MS,
  AGENT_MANIFEST_SCHEMA_VERSION,
} from "../agent-manifest.js";
import { jsonSchemaRecordSchema } from "./json-schema.js";
import {
  isRelativeTrustedEntrypoint,
  isSha256IntegrityDigest,
} from "../trusted-runtime.js";

const builtinPackageRuntimeSchema = z.strictObject({
  type: z.literal("BUILTIN_PACKAGE"),
  key: z.string().min(1),
});

const trustedTypeScriptRuntimeSchema = z.strictObject({
  type: z.literal("TRUSTED_TYPESCRIPT"),
  entrypoint: z.string().min(1).refine(isRelativeTrustedEntrypoint, {
    message:
      "runtime.entrypoint must be a relative POSIX path without .. traversal.",
  }),
  integrity: z.string().min(1).refine(isSha256IntegrityDigest, {
    message: "runtime.integrity must be a sha256:<hex> digest.",
  }),
});

export const agentRuntimeSchema = z.discriminatedUnion("type", [
  builtinPackageRuntimeSchema,
  trustedTypeScriptRuntimeSchema,
]);

const agentManifestIoSchema = z.strictObject({
  schema: jsonSchemaRecordSchema,
});

const agentManifestExecutionSchema = z.strictObject({
  timeoutMs: z
    .int()
    .min(AGENT_EXECUTION_MIN_TIMEOUT_MS)
    .max(AGENT_EXECUTION_MAX_TIMEOUT_MS),
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
