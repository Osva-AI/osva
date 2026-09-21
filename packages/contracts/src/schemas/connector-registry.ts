import { z } from "zod";

import {
  connectorIdSchema,
  connectorVersionIdSchema,
  toolIdSchema,
  toolVersionIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import {
  connectorAuthConfigSchema,
  connectorKindSchema,
  connectorTransportConfigSchema,
  connectorTransportSchema,
  streamableHttpTransportConfigSchema,
} from "./connector.js";
import { jsonSchemaRecordSchema } from "./json-schema.js";
import { utcIso8601TimestampSchema } from "./utc-instant.js";

export const createConnectorRequestSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const updateConnectorRequestSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const createConnectorVersionRequestSchema = z.strictObject({
  kind: connectorKindSchema,
  transport: connectorTransportSchema,
  transportConfig: connectorTransportConfigSchema,
  auth: connectorAuthConfigSchema.optional(),
});

export const connectorResourceSchema = z.strictObject({
  id: connectorIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  createdAt: utcIso8601TimestampSchema,
  updatedAt: utcIso8601TimestampSchema,
});

export const connectorListResourceSchema = z.strictObject({
  connectors: z.array(connectorResourceSchema),
});

export const publicSecretBindingSchema = z.strictObject({
  configured: z.literal(true),
});

export const publicConnectorBearerAuthConfigSchema = z.strictObject({
  type: z.literal("BEARER"),
  configured: z.literal(true),
});

export const publicConnectorHeaderAuthConfigSchema = z.strictObject({
  type: z.literal("HEADER"),
  headerName: z.string().min(1),
  configured: z.literal(true),
});

export const publicConnectorAuthConfigSchema = z.union([
  publicConnectorBearerAuthConfigSchema,
  publicConnectorHeaderAuthConfigSchema,
]);

export const publicStdioTransportConfigSchema = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  secretEnvironment: z.record(z.string(), publicSecretBindingSchema).optional(),
});

export const publicConnectorTransportConfigSchema = z.union([
  streamableHttpTransportConfigSchema,
  publicStdioTransportConfigSchema,
]);

export const connectorVersionResourceSchema = z.strictObject({
  id: connectorVersionIdSchema,
  connectorId: connectorIdSchema,
  version: z.int().positive(),
  kind: connectorKindSchema,
  transport: connectorTransportSchema,
  transportConfig: publicConnectorTransportConfigSchema,
  auth: publicConnectorAuthConfigSchema.optional(),
  createdAt: utcIso8601TimestampSchema,
});

export const connectorVersionListResourceSchema = z.strictObject({
  versions: z.array(connectorVersionResourceSchema),
});

export const discoveredMcpToolSchema = z.strictObject({
  remoteToolName: z.string().min(1),
  description: z.string().min(1).optional(),
  inputSchema: jsonSchemaRecordSchema,
});

export const discoverConnectorToolsResponseSchema = z.strictObject({
  connectorVersionId: connectorVersionIdSchema,
  tools: z.array(discoveredMcpToolSchema),
});

export const importMcpToolRequestSchema = z.strictObject({
  remoteToolName: z.string().min(1),
  toolKey: z.string().min(1),
  toolName: z.string().min(1),
});

export const importMcpToolsRequestSchema = z.strictObject({
  connectorVersionId: connectorVersionIdSchema,
  tools: z.array(importMcpToolRequestSchema).min(1),
});

export const importedMcpToolResourceSchema = z.strictObject({
  toolId: toolIdSchema,
  toolVersionId: toolVersionIdSchema,
  remoteToolName: z.string().min(1),
  toolKey: z.string().min(1),
  createdNewToolVersion: z.boolean(),
});

export const importMcpToolsResponseSchema = z.strictObject({
  imported: z.array(importedMcpToolResourceSchema),
});
