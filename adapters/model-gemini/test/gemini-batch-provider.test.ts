import { describe, expect, it, afterEach } from "vitest";

import { GeminiBatchProvider } from "../src/gemini-batch-provider.js";
import { startFakeGeminiBatchServer } from "./fake-gemini-batch-server.js";

describe("GeminiBatchProvider", () => {
  let server:
    Awaited<ReturnType<typeof startFakeGeminiBatchServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("submits, polls, and fetches correlated results", async () => {
    server = await startFakeGeminiBatchServer();
    const provider = new GeminiBatchProvider({
      apiKey: "test-key",
      baseURL: `${server.origin}/v1beta`,
    });

    const submit = await provider.submit({
      provider: "GOOGLE_GEMINI",
      providerModelId: "gemini-1.5-flash",
      items: [
        {
          itemId: "item_a" as never,
          providerCorrelationId: "g_b",
          input: { messages: [{ role: "user", content: "b" }] },
        },
        {
          itemId: "item_b" as never,
          providerCorrelationId: "g_a",
          input: { messages: [{ role: "user", content: "a" }] },
        },
      ],
    });

    expect(submit.providerBatchId).toContain("operations/");
    expect(server.batchCreateCount()).toBe(1);

    const status = await provider.getStatus(submit.providerBatchId);
    expect(status.providerJobStatus).toBe("COMPLETED");

    const results = await provider.fetchResults(submit.providerBatchId);
    expect(results.items).toHaveLength(2);
    const byId = new Map(
      results.items.map((row) => [row.providerCorrelationId, row] as const),
    );
    expect(byId.get("g_a")?.result?.text).toBe("gemini-g_a");
    expect(byId.get("g_b")?.result?.text).toBe("gemini-g_b");
  });
});
