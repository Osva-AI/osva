import { describe, expect, it } from "vitest";

import {
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
});
