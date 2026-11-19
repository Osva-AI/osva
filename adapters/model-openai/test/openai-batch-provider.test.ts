import { describe, expect, it, afterEach } from "vitest";

import { OpenAIBatchProvider } from "../src/openai-batch-provider.js";
import { startFakeOpenAiBatchServer } from "./fake-openai-batch-server.js";

describe("OpenAIBatchProvider", () => {
  let server:
    Awaited<ReturnType<typeof startFakeOpenAiBatchServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("submits, polls, and fetches correlated results", async () => {
    server = await startFakeOpenAiBatchServer();
    const provider = new OpenAIBatchProvider({
      apiKey: "test-key",
      baseURL: `${server.origin}/v1`,
    });

    const submit = await provider.submit({
      provider: "OPENAI",
      providerModelId: "gpt-4o-mini",
      items: [
        {
          itemId: "item_a" as never,
          providerCorrelationId: "corr_a",
          input: { messages: [{ role: "user", content: "hello" }] },
        },
      ],
    });

    expect(submit.providerBatchId).toMatch(/^batch_/);
    const status = await provider.getStatus(submit.providerBatchId);
    expect(status.providerJobStatus).toBe("COMPLETED");

    const results = await provider.fetchResults(submit.providerBatchId);
    expect(results.items).toHaveLength(1);
    expect(results.items[0]?.providerCorrelationId).toBe("corr_a");
    expect(results.items[0]?.result?.text).toBe("result-corr_a");
    expect(results.items[0]?.usage?.inputUnits).toBe(3);
  });
});
