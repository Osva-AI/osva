import { describe, expect, it, vi } from "vitest";

import { GeminiProviderAdapter } from "../src/gemini-provider-adapter.js";
import {
  describeGeminiOutboundGenerateContentRequest,
  geminiGenerateContentPathname,
  normalizeGeminiProviderBaseUrl,
} from "../src/gemini-api-base-url.js";

describe("normalizeGeminiProviderBaseUrl", () => {
  it("appends v1beta when connection stores host only", () => {
    expect(
      normalizeGeminiProviderBaseUrl(
        "https://generativelanguage.googleapis.com",
      ),
    ).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("preserves explicit v1beta base", () => {
    expect(
      normalizeGeminiProviderBaseUrl(
        "https://generativelanguage.googleapis.com/v1beta",
      ),
    ).toBe("https://generativelanguage.googleapis.com/v1beta");
  });
});

describe("M20.7.3 connection-bound outbound URL", () => {
  it("POSTs to v1beta generateContent with query-key auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const adapter = new GeminiProviderAdapter({
      apiKey: "present-not-logged",
      baseURL: "https://generativelanguage.googleapis.com",
      fetch: fetchImpl as typeof fetch,
    });

    await adapter.generateText({
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("generativelanguage.googleapis.com");
    expect(parsed.pathname).toBe(
      `/v1beta${geminiGenerateContentPathname("gemini-3.6-flash")}`,
    );
    expect(parsed.searchParams.has("key")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("describes safe outbound metadata without secrets", () => {
    const meta = describeGeminiOutboundGenerateContentRequest({
      baseURL: "https://generativelanguage.googleapis.com",
      model: "gemini-3.6-flash",
      apiKey: "secret",
      usesResponseJsonSchema: true,
      usesResponseSchema: false,
    });
    expect(meta).toMatchObject({
      method: "POST",
      hostname: "generativelanguage.googleapis.com",
      pathname: "/models/gemini-3.6-flash:generateContent",
      effectiveModelId: "gemini-3.6-flash",
      authMechanism: "query_key",
      credentialPresent: true,
      structuredOutputField: "responseJsonSchema",
    });
    expect(JSON.stringify(meta)).not.toContain("secret");
  });
});
