import { z } from "zod";

import { CONNECTOR_KINDS, CONNECTOR_TRANSPORTS } from "../connector.js";
import { validateStdioTransportEnvironment } from "../stdio-transport.js";
import { secretReferenceSchema } from "./secret-reference.js";

export const connectorKindSchema = z.enum(CONNECTOR_KINDS);

export const connectorTransportSchema = z.enum(CONNECTOR_TRANSPORTS);

export const streamableHttpTransportConfigSchema = z.strictObject({
  endpointUrl: z.url(),
});

export const stdioTransportConfigSchema = z
  .strictObject({
    command: z.string().min(1),
    args: z.array(z.string()),
    cwd: z.string().min(1).optional(),
    environment: z.record(z.string(), z.string()).optional(),
    secretEnvironment: z.record(z.string(), secretReferenceSchema).optional(),
  })
  .superRefine((value, ctx) => {
    try {
      validateStdioTransportEnvironment(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid stdio transport.",
      });
    }
  });

export const connectorTransportConfigSchema = z.union([
  streamableHttpTransportConfigSchema,
  stdioTransportConfigSchema,
]);

export const connectorBearerAuthConfigSchema = z.strictObject({
  type: z.literal("BEARER"),
  tokenSecret: secretReferenceSchema,
});

export const connectorHeaderAuthConfigSchema = z.strictObject({
  type: z.literal("HEADER"),
  headerName: z.string().min(1),
  valueSecret: secretReferenceSchema,
});

export const connectorAuthConfigSchema = z.union([
  connectorBearerAuthConfigSchema,
  connectorHeaderAuthConfigSchema,
]);
