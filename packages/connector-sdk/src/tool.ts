import type { JsonSchemaRecord } from "@osva/contracts";

import type {
  ConnectorToolContext,
  ConnectorToolHandler,
  DefinedConnectorTool,
} from "./types.js";

export interface DefineToolOptions<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaRecord;
  readonly handler: ConnectorToolHandler<TInput, TOutput>;
}

export function defineTool<TInput = unknown, TOutput = unknown>(
  options: DefineToolOptions<TInput, TOutput>,
): DefinedConnectorTool<TInput, TOutput> {
  const name = options.name.trim();
  if (name.length === 0) {
    throw new Error("Connector tool name is required.");
  }

  return {
    name,
    description: options.description,
    inputSchema: options.inputSchema,
    handler: options.handler,
  };
}

export type { ConnectorToolContext };
