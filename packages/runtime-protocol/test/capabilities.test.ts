import { describe, expect, it } from "vitest";

import { MODEL_TEXT_MAX_MESSAGES } from "@osva-ai/contracts";

import {
  runtimeKnowledgeSearchRequestSchema,
  runtimeMemoryListSuccessSchema,
  runtimeModelGenerateTextRequestSchema,
  runtimeToolInvokeRequestSchema,
} from "../src/index.js";

describe("Runtime Protocol V1 capability schemas", () => {
  it("parses model and tool capability requests without version IDs", () => {
    const model = runtimeModelGenerateTextRequestSchema.parse({
      protocolVersion: "1",
      executionId: "attempt-1",
      bindingName: "primary",
      input: { messages: [{ role: "user", content: "hi" }] },
    });
    expect("modelProfileVersionId" in model).toBe(false);

    const tool = runtimeToolInvokeRequestSchema.parse({
      protocolVersion: "1",
      executionId: "attempt-1",
      bindingName: "echo",
      input: { hello: "world" },
      idempotencyKey: "side-effect-1",
    });
    expect("toolVersionId" in tool).toBe(false);

    const knowledge = runtimeKnowledgeSearchRequestSchema.parse({
      protocolVersion: "1",
      executionId: "attempt-1",
      bindingName: "docs",
      query: "hello",
      topK: 5,
    });
    expect("knowledgeIndexIds" in knowledge).toBe(false);
  });

  it("rejects malformed capability requests", () => {
    expect(
      runtimeModelGenerateTextRequestSchema.safeParse({
        protocolVersion: "1",
        executionId: "attempt-1",
        bindingName: "primary",
        input: { messages: [] },
      }).success,
    ).toBe(false);

    expect(
      runtimeToolInvokeRequestSchema.safeParse({
        protocolVersion: "1",
        executionId: "attempt-1",
        bindingName: "not a name",
        input: {},
      }).success,
    ).toBe(false);
  });

  it("rejects oversized bounded collections with a finite issue count", () => {
    const oversize = MODEL_TEXT_MAX_MESSAGES + 40;
    const messages = Array.from({ length: oversize }, () => ({
      role: "user" as const,
      content: "x",
    }));

    const modelResult = runtimeModelGenerateTextRequestSchema.safeParse({
      protocolVersion: "1",
      executionId: "attempt-1",
      bindingName: "primary",
      input: { messages },
    });
    expect(modelResult.success).toBe(false);
    if (!modelResult.success) {
      expect(modelResult.error.issues.length).toBeLessThan(oversize);
    }

    const memoryItems = Array.from({ length: 150 }, (_, index) => ({
      key: `k-${index}`,
      value: { n: index },
      revision: 1,
    }));
    const memoryResult = runtimeMemoryListSuccessSchema.safeParse({
      protocolVersion: "1",
      executionId: "attempt-1",
      outcome: "SUCCEEDED",
      items: memoryItems,
    });
    expect(memoryResult.success).toBe(false);
  });
});
