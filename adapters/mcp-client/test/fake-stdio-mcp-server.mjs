import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createFakeMcpServer } from "../dist/testing/fake-mcp-server-core.js";

const state = {
  toolCallCount: { value: 0 },
  hangAbortWaiters: [],
};

serveStdio(() => createFakeMcpServer(state));
