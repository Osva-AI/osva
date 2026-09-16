import { z } from "zod";

import {
  AGENT_EXECUTION_MAX_TIMEOUT_MS,
  AGENT_EXECUTION_MIN_TIMEOUT_MS,
  AGENT_MANIFEST_SCHEMA_VERSION,
  AGENT_REMOTE_HTTP_PROTOCOL_VERSION,
} from "../agent-manifest.js";
import { MODEL_BINDING_NAME_PATTERN } from "../model-gateway.js";
import { isAllowedRemoteRuntimeEndpoint } from "../remote-runtime.js";
import { TOOL_BINDING_NAME_PATTERN } from "../tool-gateway.js";
import { jsonSchemaRecordSchema } from "./json-schema.js";
import { modelProfileVersionIdSchema, toolVersionIdSchema } from "./ids.js";
import { secretReferenceSchema } from "./secret-reference.js";
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

const remoteHttpRuntimeSchema = z.strictObject({
  type: z.literal("REMOTE_HTTP"),
  protocolVersion: z.literal(AGENT_REMOTE_HTTP_PROTOCOL_VERSION),
  endpoint: z.string().min(1).refine(isAllowedRemoteRuntimeEndpoint, {
    message:
      "runtime.endpoint must be an http: or https: URL with a host and without userinfo.",
  }),
  authSecretRef: secretReferenceSchema.optional(),
  timeoutMs: z
    .int()
    .min(AGENT_EXECUTION_MIN_TIMEOUT_MS)
    .max(AGENT_EXECUTION_MAX_TIMEOUT_MS)
    .optional(),
});

export const agentRuntimeSchema = z.discriminatedUnion("type", [
  builtinPackageRuntimeSchema,
  trustedTypeScriptRuntimeSchema,
  remoteHttpRuntimeSchema,
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

const agentManifestModelBindingSchema = z.strictObject({
  modelProfileVersionId: modelProfileVersionIdSchema,
});

const agentManifestModelsSchema = z.record(
  z.string().regex(MODEL_BINDING_NAME_PATTERN, {
    message:
      "model binding names must start with a letter and use only letters, digits, '_' or '-'.",
  }),
  agentManifestModelBindingSchema,
);

const agentManifestToolBindingSchema = z.strictObject({
  toolVersionId: toolVersionIdSchema,
});

const agentManifestToolsSchema = z.record(
  z.string().regex(TOOL_BINDING_NAME_PATTERN, {
    message:
      "tool binding names must start with a letter and use only letters, digits, '_' or '-'.",
  }),
  agentManifestToolBindingSchema,
);

export const agentManifestSchema = z.strictObject({
  schemaVersion: z.literal(AGENT_MANIFEST_SCHEMA_VERSION),
  key: z.string().min(1),
  name: z.string().min(1),
  runtime: agentRuntimeSchema,
  input: agentManifestIoSchema,
  output: agentManifestIoSchema,
  execution: agentManifestExecutionSchema,
  capabilities: agentManifestCapabilitiesSchema,
  models: agentManifestModelsSchema.optional(),
  tools: agentManifestToolsSchema.optional(),
});
