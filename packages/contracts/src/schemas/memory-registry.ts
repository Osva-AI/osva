import { z } from "zod";

import { jsonValueSchema } from "./json-value.js";
import { memoryNamespaceIdSchema, workspaceIdSchema } from "./ids.js";

export const createMemoryNamespaceRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const memoryNamespaceResourceSchema = z.strictObject({
  id: memoryNamespaceIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const memoryNamespaceListResourceSchema = z.strictObject({
  items: z.array(memoryNamespaceResourceSchema),
});

export const memoryRecordResourceSchema = z.strictObject({
  key: z.string().min(1),
  value: jsonValueSchema,
  revision: z.number().int().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const memoryRecordListResourceSchema = z.strictObject({
  items: z.array(memoryRecordResourceSchema),
  nextCursor: z.string().min(1).optional(),
});

export const listMemoryRecordsQuerySchema = z.strictObject({
  prefix: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  cursor: z.string().min(1).optional(),
});
