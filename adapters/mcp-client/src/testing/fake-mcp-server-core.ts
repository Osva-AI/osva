import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

/** Deterministic bearer token for fake MCP HTTP auth tests. */
export const FAKE_MCP_BEARER_TOKEN = "osva-fake-mcp-test-token";

const objectInputSchema = fromJsonSchema({
  type: "object",
  additionalProperties: true,
});

export interface FakeMcpServerState {
  readonly toolCallCount: { value: number };
  readonly hangAbortWaiters: Array<() => void>;
}

export function registerFakeMcpTools(
  server: McpServer,
  state: FakeMcpServerState,
): void {
  server.registerTool(
    "echo",
    {
      description: "Echoes tool input as text.",
      inputSchema: objectInputSchema,
    },
    async (input) => {
      state.toolCallCount.value += 1;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(input ?? {}),
          },
        ],
      };
    },
  );

  server.registerTool(
    "structured",
    {
      description: "Returns structured JSON tool output.",
      inputSchema: objectInputSchema,
    },
    async (input) => {
      state.toolCallCount.value += 1;
      const payload = {
        kind: "structured",
        value: input ?? {},
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "error",
    {
      description: "Returns an MCP tool error result.",
      inputSchema: objectInputSchema,
    },
    async () => {
      state.toolCallCount.value += 1;
      return {
        isError: true,
        content: [{ type: "text", text: "intentional fake MCP tool error" }],
      };
    },
  );

  server.registerTool(
    "hang",
    {
      description: "Never completes; used for timeout and cancellation tests.",
      inputSchema: objectInputSchema,
    },
    async (_input, context) => {
      state.toolCallCount.value += 1;
      const abortSignal = (
        context as { readonly signal?: AbortSignal } | undefined
      )?.signal;
      abortSignal?.addEventListener("abort", () => {
        for (const notify of state.hangAbortWaiters.splice(0)) {
          notify();
        }
      });
      return await new Promise<never>(() => undefined);
    },
  );

  server.registerTool(
    "malformed",
    {
      description: "Returns an MCP result that cannot be normalized.",
      inputSchema: objectInputSchema,
    },
    async () => {
      state.toolCallCount.value += 1;
      return {
        content: [
          {
            type: "resource_link",
            name: "unsupported-block",
            uri: "fake://malformed",
          },
        ],
      };
    },
  );
}

export function createFakeMcpServer(state: FakeMcpServerState): McpServer {
  const server = new McpServer(
    { name: "osva-fake-mcp", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  registerFakeMcpTools(server, state);
  return server;
}
