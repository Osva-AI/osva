import { z } from "zod";

import { toolIdSchema, toolVersionIdSchema, workspaceIdSchema } from "./ids.js";
import {
  internalToolImplementationIdSchema,
  mcpToolVersionConfigSchema,
  toolTypeSchema,
} from "./tool-gateway.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

export const createToolRequestSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
});

export const updateToolRequestSchema = z.strictObject({
  name: z.string().min(1),
});

export const createToolVersionRequestSchema = z.strictObject({
  type: toolTypeSchema,
  implementation: internalToolImplementationIdSchema,
});

export const toolResourceSchema = z.strictObject({
  id: toolIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  createdAt: utcIso8601TimestampSchema,
});

export const toolListResourceSchema = z.strictObject({
  tools: z.array(toolResourceSchema),
});

export const internalToolVersionResourceSchema = z.strictObject({
  id: toolVersionIdSchema,
  toolId: toolIdSchema,
  version: z.int().positive(),
  type: z.literal("INTERNAL"),
  implementation: internalToolImplementationIdSchema,
  createdAt: utcIso8601TimestampSchema,
});

export const mcpToolVersionResourceSchema = z.strictObject({
  id: toolVersionIdSchema,
  toolId: toolIdSchema,
  version: z.int().positive(),
  type: z.literal("MCP"),
  implementation: z.literal("MCP_V1"),
  mcp: mcpToolVersionConfigSchema,
  createdAt: utcIso8601TimestampSchema,
});

export const toolVersionResourceSchema = z.union([
  internalToolVersionResourceSchema,
  mcpToolVersionResourceSchema,
]);

export const toolVersionListResourceSchema = z.strictObject({
  versions: z.array(toolVersionResourceSchema),
});
