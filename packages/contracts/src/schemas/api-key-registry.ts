import { z } from "zod";

import {
  API_KEY_NAME_MAX_LENGTH,
  COMMUNITY_EDITION_ROLES,
} from "../security.js";
import { apiKeyIdSchema } from "./ids.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

export const communityEditionRoleSchema = z.enum([
  COMMUNITY_EDITION_ROLES.VIEWER,
  COMMUNITY_EDITION_ROLES.OPERATOR,
  COMMUNITY_EDITION_ROLES.EDITOR,
  COMMUNITY_EDITION_ROLES.ADMIN,
]);

export const apiKeyResourceSchema = z.strictObject({
  id: apiKeyIdSchema,
  name: z.string().min(1),
  role: communityEditionRoleSchema,
  createdAt: utcIso8601TimestampSchema,
  expiresAt: utcIso8601TimestampSchema.optional(),
  revokedAt: utcIso8601TimestampSchema.optional(),
});

export const createApiKeyRequestSchema = z.strictObject({
  name: z.string().min(1).max(API_KEY_NAME_MAX_LENGTH),
  role: communityEditionRoleSchema,
  expiresAt: utcIso8601TimestampSchema.optional(),
});

export const createApiKeyResponseSchema = z.strictObject({
  apiKey: apiKeyResourceSchema,
  token: z.string().min(1),
});

export const apiKeyListResourceSchema = z.strictObject({
  apiKeys: z.array(apiKeyResourceSchema),
});

export const revokeApiKeyResponseSchema = z.strictObject({
  apiKey: apiKeyResourceSchema,
});
