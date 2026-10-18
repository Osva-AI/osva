import { z } from "zod";

import {
  modelProviderConnectionIdSchema,
  modelProviderConnectionVersionIdSchema,
  modelProfileVersionIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { modelProviderSchema } from "./model-gateway.js";
import { secretReferenceSchema } from "./secret-reference.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";
import { isAllowedRemoteRuntimeEndpoint } from "../remote-runtime.js";

export const modelProviderConnectionEndpointSchema = z.strictObject({
  baseUrl: z.string().min(1).refine(isAllowedRemoteRuntimeEndpoint, {
    message:
      "endpoint.baseUrl must be a valid http(s) URL without credentials.",
  }),
  allowPrivateNetworks: z.boolean().optional(),
});

export const createModelProviderConnectionRequestSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  provider: modelProviderSchema,
});

export const updateModelProviderConnectionRequestSchema = z.strictObject({
  name: z.string().min(1),
});

export const createModelProviderConnectionVersionRequestSchema = z.strictObject(
  {
    endpoint: modelProviderConnectionEndpointSchema.optional(),
    credentialRef: secretReferenceSchema.optional(),
  },
);

export const publicModelProviderCredentialSchema = z.strictObject({
  configured: z.literal(true),
});

export const modelProviderConnectionResourceSchema = z.strictObject({
  id: modelProviderConnectionIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  provider: modelProviderSchema,
  createdAt: utcIso8601TimestampSchema,
  updatedAt: utcIso8601TimestampSchema,
});

export const modelProviderConnectionVersionResourceSchema = z.strictObject({
  id: modelProviderConnectionVersionIdSchema,
  connectionId: modelProviderConnectionIdSchema,
  version: z.int().positive(),
  provider: modelProviderSchema,
  endpoint: modelProviderConnectionEndpointSchema.optional(),
  credential: publicModelProviderCredentialSchema.optional(),
  createdAt: utcIso8601TimestampSchema,
});

export const modelProviderConnectionListResourceSchema = z.strictObject({
  connections: z.array(modelProviderConnectionResourceSchema),
});

export const modelProviderConnectionVersionListResourceSchema = z.strictObject({
  versions: z.array(modelProviderConnectionVersionResourceSchema),
});

export const modelProviderConnectionTestRequestSchema = z
  .strictObject({
    model: z.string().min(1).optional(),
    modelProfileVersionId: modelProfileVersionIdSchema.optional(),
  })
  .refine(
    (value) =>
      value.model !== undefined || value.modelProfileVersionId !== undefined,
    {
      message: "Either model or modelProfileVersionId is required.",
    },
  );

export const modelProviderConnectionTestResourceSchema = z.strictObject({
  status: z.enum(["READY", "FAILED"]),
  checkedAt: utcIso8601TimestampSchema,
  code: z.string().min(1).optional(),
});
