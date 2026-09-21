import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { toMcpToolError, toMcpToolResult } from "./result.js";
import type {
  ConnectorMetadata,
  DefinedConnector,
  DefinedConnectorTool,
} from "./types.js";

export interface DefineConnectorOptions {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly version: string;
  readonly tools: readonly DefinedConnectorTool[];
}

export function defineConnector(
  options: DefineConnectorOptions,
): DefinedConnector {
  const metadata: ConnectorMetadata = {
    key: options.key,
    name: options.name,
    description: options.description,
    version: options.version,
  };

  const names = new Set<string>();
  for (const tool of options.tools) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate connector tool name '${tool.name}'.`);
    }
    names.add(tool.name);
  }

  return {
    metadata,
    tools: [...options.tools],
  };
}

export function createMcpServerFromConnector(
  connector: DefinedConnector,
): McpServer {
  const server = new McpServer(
    {
      name: connector.metadata.key,
      version: connector.metadata.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  for (const tool of connector.tools) {
    const inputSchema = fromJsonSchema(tool.inputSchema);
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
      },
      async (input, context) => {
        try {
          const output = await tool.handler(input, {
            signal: (context as { signal?: AbortSignal } | undefined)?.signal,
          });
          return toMcpToolResult(output) as {
            content: [{ type: "text"; text: string }];
            structuredContent?: Record<string, unknown>;
            isError?: boolean;
          };
        } catch (error) {
          return toMcpToolError(error) as {
            content: [{ type: "text"; text: string }];
            structuredContent?: Record<string, unknown>;
            isError?: boolean;
          };
        }
      },
    );
  }

  return server;
}
