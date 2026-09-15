import { z } from "zod";

import { agentManifestSchema } from "./agent-manifest.js";
import {
  agentIdSchema,
  agentVersionIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

export const createAgentRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
});

export const updateAgentRequestSchema = z.strictObject({
  name: z.string().min(1),
});

export const createAgentVersionRequestSchema = z.strictObject({
  manifest: agentManifestSchema,
});

export const agentResourceSchema = z.strictObject({
  id: agentIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  createdAt: utcIso8601TimestampSchema,
});

export const agentVersionResourceSchema = z.strictObject({
  id: agentVersionIdSchema,
  agentId: agentIdSchema,
  version: z.int().positive(),
  manifest: agentManifestSchema,
  createdAt: utcIso8601TimestampSchema,
});

export const agentListResourceSchema = z.strictObject({
  agents: z.array(agentResourceSchema),
});

export const agentVersionListResourceSchema = z.strictObject({
  versions: z.array(agentVersionResourceSchema),
});
