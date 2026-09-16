import type { GenerateTextInput, JsonValue } from "@osva/contracts";
import {
  RUNTIME_CAPABILITY_PATHS,
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_VERSION,
  runtimeModelGenerateTextRequestSchema,
  runtimeModelGenerateTextResponseSchema,
  runtimeToolInvokeRequestSchema,
  runtimeToolInvokeResponseSchema,
} from "@osva/runtime-protocol";

import { CapabilityCredential } from "./capability-credential.js";
import { RuntimeCapabilityError } from "./errors.js";

export interface GenerateTextOptions {
  readonly binding: string;
  readonly messages: GenerateTextInput["messages"];
  readonly maxOutputTokens?: number;
}

export interface InvokeToolOptions {
  readonly binding: string;
  readonly input: JsonValue;
  readonly idempotencyKey?: string;
}

export interface RuntimeContext {
  /**
   * Opaque runtime idempotency identity mapped 1:1 to the canonical RunAttempt.
   * Implement durable deduplication yourself when required; the SDK does not
   * provide in-memory durable idempotency.
   */
  readonly executionId: string;
  readonly models: {
    generateText(options: GenerateTextOptions): Promise<{ text: string }>;
  };
  readonly tools: {
    invoke(options: InvokeToolOptions): Promise<JsonValue>;
  };
}

export interface CreateRuntimeContextOptions {
  readonly executionId: string;
  readonly credential: CapabilityCredential;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createRuntimeContext(
  options: CreateRuntimeContextOptions,
): RuntimeContext {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    executionId: options.executionId,
    models: {
      generateText: async (input) => {
        const payload = runtimeModelGenerateTextRequestSchema.parse({
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: options.executionId,
          bindingName: input.binding,
          input: {
            messages: input.messages,
            ...(input.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: input.maxOutputTokens }),
          },
        });

        const response = await postCapability(
          fetchImpl,
          options.credential,
          RUNTIME_CAPABILITY_PATHS.generateText,
          payload,
          timeoutMs,
        );
        const parsed = runtimeModelGenerateTextResponseSchema.parse(response);
        if (parsed.executionId !== options.executionId) {
          throw new RuntimeCapabilityError(
            "Capability response executionId mismatch.",
          );
        }
        if (parsed.outcome === "FAILED") {
          throw new RuntimeCapabilityError(
            parsed.error.message,
            parsed.error.code,
          );
        }
        return parsed.result;
      },
    },
    tools: {
      invoke: async (input) => {
        const payload = runtimeToolInvokeRequestSchema.parse({
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: options.executionId,
          bindingName: input.binding,
          input: input.input,
          ...(input.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: input.idempotencyKey }),
        });

        const response = await postCapability(
          fetchImpl,
          options.credential,
          RUNTIME_CAPABILITY_PATHS.invokeTool,
          payload,
          timeoutMs,
        );
        const parsed = runtimeToolInvokeResponseSchema.parse(response);
        if (parsed.executionId !== options.executionId) {
          throw new RuntimeCapabilityError(
            "Capability response executionId mismatch.",
          );
        }
        if (parsed.outcome === "FAILED") {
          throw new RuntimeCapabilityError(
            parsed.error.message,
            parsed.error.code,
          );
        }
        return parsed.output;
      },
    },
  };
}

async function postCapability(
  fetchImpl: typeof fetch,
  credential: CapabilityCredential,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(`${credential.endpoint}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: credential.authorizationHeader(),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new RuntimeCapabilityError(
      "Capability transport failed.",
      RUNTIME_PROTOCOL_ERROR_CODES.TRANSPORT_FAILURE,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new RuntimeCapabilityError(
      `Capability request failed with HTTP ${String(response.status)}.`,
      RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new RuntimeCapabilityError(
      "Capability response was not valid JSON.",
      RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
      { cause: error },
    );
  }
}
