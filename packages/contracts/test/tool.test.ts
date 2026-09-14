import { describe, expect, it } from "vitest";

import { toolGrantSchema, toolInvocationSchema } from "../src/schemas/tool.js";

const validInvocation = {
  toolVersionId: "tool-version-1",
  input: { query: "weather" },
  operationId: "logical-op-1",
};

describe("ToolGrant", () => {
  it("authorizes a logical Tool by toolId only", () => {
    const parsed = toolGrantSchema.parse({ toolId: "tool-1" });
    expect(parsed).toEqual({ toolId: "tool-1" });
  });

  it("does not require toolVersionId", () => {
    expect("toolVersionId" in toolGrantSchema.shape).toBe(false);

    const parsed = toolGrantSchema.safeParse({
      toolId: "tool-1",
      toolVersionId: "tool-version-1",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("Tool invocation", () => {
  it("requires ToolVersion identity", () => {
    const withoutVersion: Record<string, unknown> = { ...validInvocation };
    delete withoutVersion.toolVersionId;
    const parsed = toolInvocationSchema.safeParse(withoutVersion);
    expect(parsed.success).toBe(false);
  });

  it("requires a non-empty operationId", () => {
    const withoutOperation: Record<string, unknown> = { ...validInvocation };
    delete withoutOperation.operationId;
    expect(toolInvocationSchema.safeParse(withoutOperation).success).toBe(
      false,
    );

    const emptyOperation = toolInvocationSchema.safeParse({
      ...validInvocation,
      operationId: "",
    });
    expect(emptyOperation.success).toBe(false);
  });

  it("treats idempotencyKey as optional", () => {
    const parsed = toolInvocationSchema.parse(validInvocation);
    expect(parsed.idempotencyKey).toBeUndefined();

    const withKey = toolInvocationSchema.parse({
      ...validInvocation,
      idempotencyKey: "side-effect-1",
    });
    expect(withKey.idempotencyKey).toBe("side-effect-1");
  });
});
