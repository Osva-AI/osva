import Anthropic from "@anthropic-ai/sdk";
import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import { AnthropicProviderAdapter } from "../src/anthropic-provider-adapter.js";
import { readAnthropicSdkProviderMessage } from "../src/anthropic-sdk-error-body.js";
import { anthropicErrorMetadata } from "../src/anthropic-provider-error-metadata.js";

describe("Anthropic SDK error attachment shape", () => {
  const providerBody = {
    type: "error",
    error: {
      type: "invalid_request_error",
      message:
        "output_config.format.schema.properties.agents: Invalid schema at path #/properties/agents",
    },
  };

  function mockFetch(): typeof fetch {
    return vi.fn(async () => {
      return new Response(JSON.stringify(providerBody), {
        status: 400,
        headers: {
          "content-type": "application/json",
          "request-id": "req_sdk_shape",
        },
      });
    }) as typeof fetch;
  }

  it("attaches parsed provider JSON on BadRequestError.error", async () => {
    const client = new Anthropic({
      apiKey: "test-key",
      baseURL: "https://example.test",
      fetch: mockFetch(),
      maxRetries: 0,
    });

    const caught = await client.messages
      .create({
        model: "claude-sonnet-5-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "hello" }],
      })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(Anthropic.BadRequestError);
    const sdkError = caught as InstanceType<typeof Anthropic.BadRequestError>;
    expect(sdkError.status).toBe(400);
    expect(readAnthropicSdkProviderMessage(sdkError.error)).toBe(
      providerBody.error.message,
    );
    expect(String(sdkError.message)).toContain("400");
    expect(String(sdkError.message)).not.toBe(providerBody.error.message);

    const meta = anthropicErrorMetadata(sdkError);
    expect(meta.providerErrorType).toBe("invalid_request_error");
    expect(meta.providerErrorCode).toBe("unsupported_schema_feature");
    expect(meta.providerRequestId).toBe("req_sdk_shape");
    expect(meta.providerErrorParam).toBe(
      "output_config.format.schema.properties.agents",
    );
  });

  it("maps SDK attachment through the OSVA adapter without losing classification fields", async () => {
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: "https://example.test",
      fetch: mockFetch(),
      maxRetries: 0,
    });

    await expect(
      adapter.generateText({
        model: "claude-sonnet-5-5",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      providerErrorType: "invalid_request_error",
      providerErrorCode: "unsupported_schema_feature",
      providerErrorParam: "output_config.format.schema.properties.agents",
      providerRequestId: "req_sdk_shape",
    });
  });
});
