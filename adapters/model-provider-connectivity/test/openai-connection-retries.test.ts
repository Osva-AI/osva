import { OPENAI_CONNECTION_RESOLVED_MAX_RETRIES } from "@osva/adapters-model-openai";
import { describe, expect, it } from "vitest";

describe("ModelProviderConnectionResolver OpenAI retries", () => {
  it("uses zero SDK retries for connection-resolved OpenAI adapters", () => {
    expect(OPENAI_CONNECTION_RESOLVED_MAX_RETRIES).toBe(0);
  });
});
