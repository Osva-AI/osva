import { describe, expect, it } from "vitest";

import {
  CONNECTOR_MCP_IMPORT_MAX_TOOLS,
  MODEL_MAX_TOOL_CALLS,
  MODEL_TEXT_MAX_MESSAGES,
} from "../src/index.js";
import { importMcpToolsRequestSchema } from "../src/schemas/connector-registry.js";
import {
  generateCompletionResultSchema,
  generateTextInputSchema,
} from "../src/schemas/model-gateway.js";
import { executionRequestSchema } from "../src/schemas/runtime-protocol.js";

describe("Zod collection validation security (GHSA-mrhx-c7xc-m3w5)", () => {
  it("accepts existing valid bounded contract payloads", () => {
    expect(
      generateTextInputSchema.safeParse({
        messages: [{ role: "user", content: "hi" }],
      }).success,
    ).toBe(true);

    expect(
      executionRequestSchema.safeParse({
        runId: "run-1",
        runAttemptId: "attempt-1",
        workspaceId: "ws-1",
        agentId: "agent-1",
        agentVersionId: "agent-version-1",
        runtime: {
          type: "BUILTIN_PACKAGE",
          key: "echo",
        },
        input: { prompt: "hello" },
        effectiveConfig: {},
        modelProfileVersionBindings: {},
        toolVersionBindings: {},
        memoryNamespaceBindings: {},
        toolGrants: [],
        timeoutMs: 30_000,
        policyContext: {},
      }).success,
    ).toBe(true);
  });

  it("rejects oversized message arrays before element validation", () => {
    const oversize = MODEL_TEXT_MAX_MESSAGES + 50;
    const messages = Array.from({ length: oversize }, (_, index) => ({
      role: "user" as const,
      content: `msg-${index}`,
    }));

    const result = generateTextInputSchema.safeParse({ messages });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues.length).toBeLessThan(oversize);
  });

  it("rejects malformed nested completion toolCalls with a bounded issue set", () => {
    const oversize = MODEL_MAX_TOOL_CALLS + 25;
    const toolCalls = Array.from({ length: oversize }, (_, index) => ({
      id: `call-${index}`,
      name: "echo",
      arguments: { n: index },
    }));

    const result = generateCompletionResultSchema.safeParse({
      toolCalls,
      finishReason: "tool_call",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues.length).toBeLessThan(oversize);
  });

  it("rejects oversized MCP import batches", () => {
    const oversize = CONNECTOR_MCP_IMPORT_MAX_TOOLS + 5;
    const tools = Array.from({ length: oversize }, (_, index) => ({
      remoteToolName: `remote-${index}`,
      toolKey: `tool-${index}`,
      toolName: `Tool ${index}`,
    }));

    const result = importMcpToolsRequestSchema.safeParse({
      connectorVersionId: "connector-version-1",
      tools,
    });
    expect(result.success).toBe(false);
  });

  it("classifies oversized tool grant lists without unbounded issue accumulation", () => {
    const oversize = 128;
    const toolGrants = Array.from({ length: oversize }, () => ({
      toolId: "tool-1",
    }));

    const result = executionRequestSchema.safeParse({
      runId: "run-1",
      runAttemptId: "attempt-1",
      workspaceId: "ws-1",
      agentId: "agent-1",
      agentVersionId: "agent-version-1",
      runtime: {
        type: "BUILTIN_PACKAGE",
        key: "echo",
      },
      input: {},
      effectiveConfig: {},
      modelProfileVersionBindings: {},
      toolVersionBindings: {},
      memoryNamespaceBindings: {},
      toolGrants,
      timeoutMs: 30_000,
      policyContext: {},
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.issues.length).toBeLessThan(oversize);
  });
});
