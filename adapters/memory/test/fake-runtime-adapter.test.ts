import type { ExecutionRequest, RuntimeAdapter } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { FakeRuntimeAdapter } from "../src/fake-runtime-adapter.js";
import { createExecutionRequest } from "./fixtures.js";

describe("FakeRuntimeAdapter", () => {
  it("returns a successful execution result from the handler", async () => {
    const adapter: RuntimeAdapter = new FakeRuntimeAdapter(async () => ({
      status: "succeeded",
      output: { answer: 42 },
    }));

    await expect(adapter.execute(createExecutionRequest())).resolves.toEqual({
      status: "succeeded",
      output: { answer: 42 },
    });
  });

  it("returns a failed execution result from the handler", async () => {
    const adapter: RuntimeAdapter = new FakeRuntimeAdapter(async () => ({
      status: "failed",
      error: { code: "AGENT_FAILED", message: "output invalid" },
    }));

    await expect(adapter.execute(createExecutionRequest())).resolves.toEqual({
      status: "failed",
      error: { code: "AGENT_FAILED", message: "output invalid" },
    });
  });

  it("passes request identity and effective bindings to the handler", async () => {
    let seen: ExecutionRequest | undefined;
    const request = createExecutionRequest();
    const adapter: RuntimeAdapter = new FakeRuntimeAdapter(async (incoming) => {
      seen = incoming;
      return { status: "succeeded", output: null };
    });

    await adapter.execute(request);

    expect(seen?.runId).toBe(request.runId);
    expect(seen?.runAttemptId).toBe(request.runAttemptId);
    expect(seen?.agentVersionId).toBe(request.agentVersionId);
    expect(seen?.modelProfileVersionBindings).toEqual(
      request.modelProfileVersionBindings,
    );
  });

  it("propagates thrown handler errors without rewriting them", async () => {
    const adapter: RuntimeAdapter = new FakeRuntimeAdapter(async () => {
      throw new Error("handler exploded");
    });

    await expect(adapter.execute(createExecutionRequest())).rejects.toThrow(
      "handler exploded",
    );
    await expect(
      adapter.execute(createExecutionRequest()),
    ).rejects.not.toMatchObject({
      status: "failed",
    });
  });
});
