import { defineConnector, defineTool } from "@osva/connector-sdk";

export const echoConnector = defineConnector({
  key: "osva-echo-connector",
  name: "OSVA Echo Connector",
  description:
    "Deterministic echo connector for OSVA Connector Profile V1 demos.",
  version: "1.0.0",
  tools: [
    defineTool({
      name: "echo",
      description: "Echoes the input message field.",
      inputSchema: {
        type: "object",
        additionalProperties: true,
      },
      handler: async (input) => {
        const record = (input ?? {}) as { message?: string; value?: unknown };
        if (record.message !== undefined) {
          return { echoed: record.message };
        }
        return { echoed: record.value ?? input };
      },
    }),
    defineTool({
      name: "ping",
      description: "Returns a static pong payload.",
      inputSchema: { type: "object" },
      handler: async () => ({ pong: true }),
    }),
  ],
});
