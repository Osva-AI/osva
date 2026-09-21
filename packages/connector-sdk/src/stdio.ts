import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import type { DefinedConnector } from "./types.js";
import { createMcpServerFromConnector } from "./connector.js";

export async function serveStdio(connector: DefinedConnector): Promise<void> {
  const server = createMcpServerFromConnector(connector);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
