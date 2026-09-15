import { z } from "zod";

import {
  modelProfileIdSchema,
  modelProfileVersionIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import {
  modelProviderModelIdSchema,
  modelProviderSchema,
} from "./model-gateway.js";
import { modelProfileVersionPricingSchema } from "./model-pricing.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

export const createModelProfileRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
});

export const updateModelProfileRequestSchema = z.strictObject({
  name: z.string().min(1),
});

export const createModelProfileVersionRequestSchema = z.strictObject({
  provider: modelProviderSchema,
  model: modelProviderModelIdSchema,
  pricing: modelProfileVersionPricingSchema.optional(),
});

export const modelProfileResourceSchema = z.strictObject({
  id: modelProfileIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  createdAt: utcIso8601TimestampSchema,
});

export const modelProfileVersionResourceSchema = z.strictObject({
  id: modelProfileVersionIdSchema,
  modelProfileId: modelProfileIdSchema,
  version: z.int().positive(),
  provider: modelProviderSchema,
  model: modelProviderModelIdSchema,
  pricing: modelProfileVersionPricingSchema.optional(),
  createdAt: utcIso8601TimestampSchema,
});

export const modelProfileListResourceSchema = z.strictObject({
  modelProfiles: z.array(modelProfileResourceSchema),
});

export const modelProfileVersionListResourceSchema = z.strictObject({
  versions: z.array(modelProfileVersionResourceSchema),
});
