import type { GenerateTextInput, JsonValue } from "@osva/contracts";
import {
  RUNTIME_CAPABILITY_PATHS,
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_VERSION,
  runtimeMemoryDeleteRequestSchema,
  runtimeMemoryDeleteResponseSchema,
  runtimeMemoryGetRequestSchema,
  runtimeMemoryGetResponseSchema,
  runtimeMemoryListRequestSchema,
  runtimeMemoryListResponseSchema,
  runtimeMemorySetRequestSchema,
  runtimeMemorySetResponseSchema,
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

export interface MemoryGetOptions {
  readonly binding: string;
  readonly key: string;
}

export interface MemorySetOptions {
  readonly binding: string;
  readonly key: string;
  readonly value: JsonValue;
  readonly expectedRevision?: number;
}

export interface MemoryDeleteOptions {
  readonly binding: string;
  readonly key: string;
  readonly expectedRevision?: number;
}

export interface MemoryListOptions {
  readonly binding: string;
  readonly prefix?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface MemoryRecordView {
  readonly key: string;
  readonly value: JsonValue;
  readonly revision: number;
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
  readonly memory: {
    get(options: MemoryGetOptions): Promise<MemoryRecordView>;
    set(options: MemorySetOptions): Promise<MemoryRecordView>;
    delete(options: MemoryDeleteOptions): Promise<void>;
    list(options: MemoryListOptions): Promise<{
      readonly items: readonly MemoryRecordView[];
      readonly nextCursor?: string;
    }>;
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
    memory: {
      get: async (input) => {
        const payload = runtimeMemoryGetRequestSchema.parse({
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: options.executionId,
          bindingName: input.binding,
          key: input.key,
        });

        const response = await postCapability(
          fetchImpl,
          options.credential,
          RUNTIME_CAPABILITY_PATHS.memoryGet,
          payload,
          timeoutMs,
        );
        const parsed = runtimeMemoryGetResponseSchema.parse(response);
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
        return parsed.record;
      },
      set: async (input) => {
        const payload = runtimeMemorySetRequestSchema.parse({
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: options.executionId,
          bindingName: input.binding,
          key: input.key,
          value: input.value,
          ...(input.expectedRevision === undefined
            ? {}
            : { expectedRevision: input.expectedRevision }),
        });

        const response = await postCapability(
          fetchImpl,
          options.credential,
          RUNTIME_CAPABILITY_PATHS.memorySet,
          payload,
          timeoutMs,
        );
        const parsed = runtimeMemorySetResponseSchema.parse(response);
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
        return parsed.record;
      },
      delete: async (input) => {
        const payload = runtimeMemoryDeleteRequestSchema.parse({
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: options.executionId,
          bindingName: input.binding,
          key: input.key,
          ...(input.expectedRevision === undefined
            ? {}
            : { expectedRevision: input.expectedRevision }),
        });

        const response = await postCapability(
          fetchImpl,
          options.credential,
          RUNTIME_CAPABILITY_PATHS.memoryDelete,
          payload,
          timeoutMs,
        );
        const parsed = runtimeMemoryDeleteResponseSchema.parse(response);
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
      },
      list: async (input) => {
        const payload = runtimeMemoryListRequestSchema.parse({
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: options.executionId,
          bindingName: input.binding,
          ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        });

        const response = await postCapability(
          fetchImpl,
          options.credential,
          RUNTIME_CAPABILITY_PATHS.memoryList,
          payload,
          timeoutMs,
        );
        const parsed = runtimeMemoryListResponseSchema.parse(response);
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
        return {
          items: parsed.items,
          nextCursor: parsed.nextCursor,
        };
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
