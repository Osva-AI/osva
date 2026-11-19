import { describe, expect, it, afterEach } from "vitest";

import { AnthropicBatchProvider } from "../src/anthropic-batch-provider.js";
import { startFakeAnthropicBatchServer } from "./fake-anthropic-batch-server.js";

describe("AnthropicBatchProvider", () => {
  let server:
    Awaited<ReturnType<typeof startFakeAnthropicBatchServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("submits, polls, and fetches correlated results", async () => {
    server = await startFakeAnthropicBatchServer();
    const provider = new AnthropicBatchProvider({
      apiKey: "test-key",
      baseURL: server.origin,
    });

    const submit = await provider.submit({
      provider: "ANTHROPIC",
      providerModelId: "claude-3-5-sonnet-20241022",
      items: [
        {
          itemId: "item_a" as never,
          providerCorrelationId: "corr_b",
          input: { messages: [{ role: "user", content: "one" }] },
        },
        {
          itemId: "item_b" as never,
          providerCorrelationId: "corr_a",
          input: { messages: [{ role: "user", content: "two" }] },
        },
      ],
    });

    expect(submit.providerBatchId).toMatch(/^msgbatch_/);
    expect(server.batchCreateCount()).toBe(1);

    const status = await provider.getStatus(submit.providerBatchId);
    expect(status.providerJobStatus).toBe("COMPLETED");

    const results = await provider.fetchResults(submit.providerBatchId);
    expect(results.items).toHaveLength(2);
    const byId = new Map(
      results.items.map((row) => [row.providerCorrelationId, row] as const),
    );
    expect(byId.get("corr_a")?.result?.text).toBe("anthropic-corr_a");
    expect(byId.get("corr_b")?.result?.text).toBe("anthropic-corr_b");
  });

  it("reports mixed item failures", async () => {
    server = await startFakeAnthropicBatchServer({
      failCorrelationIds: ["corr_bad"],
    });
    const provider = new AnthropicBatchProvider({
      apiKey: "test-key",
      baseURL: server.origin,
    });
    const submit = await provider.submit({
      provider: "ANTHROPIC",
      providerModelId: "claude-3-5-sonnet-20241022",
      items: [
        {
          itemId: "i1" as never,
          providerCorrelationId: "corr_ok",
          input: { messages: [{ role: "user", content: "ok" }] },
        },
        {
          itemId: "i2" as never,
          providerCorrelationId: "corr_bad",
          input: { messages: [{ role: "user", content: "bad" }] },
        },
      ],
    });
    const results = await provider.fetchResults(submit.providerBatchId);
    const failed = results.items.find(
      (row) => row.providerCorrelationId === "corr_bad",
    );
    expect(failed?.error).toBeDefined();
  });
});
