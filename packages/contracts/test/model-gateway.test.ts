import { describe, expect, it } from "vitest";

import type {
  GenerateTextInput,
  GenerateTextRequest,
  ModelGateway,
} from "../src/model-gateway.js";
import {
  generateTextInputSchema,
  modelProviderModelIdSchema,
  modelRequestSchema,
} from "../src/schemas/model-gateway.js";

type ExpectTrue<T extends true> = T;
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type _GenerateTextInputHasNoSignal = ExpectTrue<
  Equals<Extract<keyof GenerateTextInput, "signal">, never>
>;
type _GenerateTextRequestHasNoSignal = ExpectTrue<
  Equals<Extract<keyof GenerateTextRequest, "signal">, never>
>;
type _ModelGatewayGenerateTextArity = ExpectTrue<
  Equals<Parameters<ModelGateway["generateText"]>["length"], 1>
>;
type ModelGatewayRequest = Parameters<ModelGateway["generateText"]>[0];
type _ModelGatewayRequestHasNoSignal = ExpectTrue<
  Equals<Extract<keyof ModelGatewayRequest, "signal">, never>
>;

const validRequest = {
  modelProfileVersionId: "model-profile-version-1",
  instructions: "Answer briefly.",
  input: { prompt: "hello" },
  timeoutMs: 10_000,
  metadata: {},
};

describe("Model request", () => {
  it("requires ModelProfileVersionId", () => {
    const withoutVersion: Record<string, unknown> = { ...validRequest };
    delete withoutVersion.modelProfileVersionId;
    const parsed = modelRequestSchema.safeParse(withoutVersion);
    expect(parsed.success).toBe(false);
  });

  it("parses a request bound to a ModelProfileVersion", () => {
    const parsed = modelRequestSchema.parse(validRequest);
    expect(parsed.modelProfileVersionId).toBe("model-profile-version-1");
  });
});

describe("Stage 1 generateText input", () => {
  const portableRequestTypes: [
    _GenerateTextInputHasNoSignal,
    _GenerateTextRequestHasNoSignal,
    _ModelGatewayGenerateTextArity,
    _ModelGatewayRequestHasNoSignal,
  ] = [true, true, true, true];

  it("parses system, user, and assistant messages", () => {
    const parsed = generateTextInputSchema.parse({
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Explain OSVA." },
        { role: "assistant", content: "OSVA is an agent operating layer." },
      ],
      maxOutputTokens: 500,
    });
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.maxOutputTokens).toBe(500);
  });

  it("rejects empty messages and unknown roles", () => {
    expect(generateTextInputSchema.safeParse({ messages: [] }).success).toBe(
      false,
    );
    expect(
      generateTextInputSchema.safeParse({
        messages: [{ role: "tool", content: "nope" }],
      }).success,
    ).toBe(false);
  });

  it("accepts provider model IDs without an OpenAI naming convention", () => {
    expect(modelProviderModelIdSchema.parse("gpt-5.1")).toBe("gpt-5.1");
    expect(modelProviderModelIdSchema.parse("gpt-5.1-2026-01-15")).toBe(
      "gpt-5.1-2026-01-15",
    );
    expect(modelProviderModelIdSchema.parse("local-custom-model")).toBe(
      "local-custom-model",
    );
    expect(modelProviderModelIdSchema.safeParse("").success).toBe(false);
  });

  it("does not accept AbortSignal on the public generateText contract", () => {
    expect(
      generateTextInputSchema.safeParse({
        messages: [{ role: "user", content: "Explain OSVA." }],
        signal: {},
      }).success,
    ).toBe(false);

    const requestKeys: Array<keyof GenerateTextRequest> = [
      "modelProfileVersionId",
      "messages",
      "maxOutputTokens",
    ];
    expect(requestKeys).not.toContain("signal");
    expect(portableRequestTypes.every(Boolean)).toBe(true);
  });
});
