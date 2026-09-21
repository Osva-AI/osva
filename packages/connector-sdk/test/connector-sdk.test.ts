import { describe, expect, it } from "vitest";

import {
  ConnectorSdkError,
  defineConnector,
  defineTool,
} from "../src/index.js";
import { toMcpToolError, toMcpToolResult } from "../src/result.js";

describe("@osva/connector-sdk", () => {
  it("defines connector metadata and tools", () => {
    const connector = defineConnector({
      key: "echo",
      name: "Echo Connector",
      version: "1.0.0",
      tools: [
        defineTool({
          name: "echo",
          description: "Echo input",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
          },
          handler: async (input) => input,
        }),
      ],
    });

    expect(connector.metadata.key).toBe("echo");
    expect(connector.tools).toHaveLength(1);
  });

  it("rejects duplicate tool names", () => {
    expect(() =>
      defineConnector({
        key: "dup",
        name: "Dup",
        version: "1.0.0",
        tools: [
          defineTool({
            name: "same",
            description: "one",
            inputSchema: { type: "object" },
            handler: async () => ({}),
          }),
          defineTool({
            name: "same",
            description: "two",
            inputSchema: { type: "object" },
            handler: async () => ({}),
          }),
        ],
      }),
    ).toThrow(/Duplicate connector tool name/);
  });

  it("maps structured output and errors", () => {
    const result = toMcpToolResult({ ok: true });
    expect(result.structuredContent).toEqual({ ok: true });

    const error = toMcpToolError(new ConnectorSdkError("TEST", "failed"));
    expect(error.isError).toBe(true);
    expect(error.structuredContent?.code).toBe("TEST");
  });

  it("propagates cancellation to handlers", async () => {
    const controller = new AbortController();
    const tool = defineTool({
      name: "wait",
      description: "wait",
      inputSchema: { type: "object" },
      handler: async (_input, context) => {
        await new Promise<void>((_resolve, reject) => {
          const signal = context.signal;
          if (signal === undefined) {
            reject(new Error("missing signal"));
            return;
          }
          if (signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
        return {};
      },
    });

    const pending = tool.handler({}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });
});
