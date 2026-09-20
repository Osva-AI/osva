import type {
  ArtifactId,
  GenerateTextInput,
  JsonObject,
  JsonValue,
} from "@osva/contracts";
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
  runtimeArtifactCreateResponseSchema,
  runtimeArtifactGetRequestSchema,
  runtimeArtifactGetResponseSchema,
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

export interface ArtifactView {
  readonly id: ArtifactId;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly metadata: JsonObject;
  readonly reference: {
    readonly type: "artifact";
    readonly artifactId: ArtifactId;
  };
}

export interface CreateArtifactOptions {
  readonly name: string;
  readonly content: Blob;
  readonly mediaType?: string;
  readonly metadata?: JsonObject;
  readonly idempotencyKey?: string;
  readonly expectedDigest?: string;
}

export interface OpenArtifactResult {
  readonly artifact: ArtifactView;
  readonly stream: ReadableStream<Uint8Array>;
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
  readonly artifacts: {
    get(artifactId: ArtifactId): Promise<ArtifactView>;
    create(options: CreateArtifactOptions): Promise<ArtifactView>;
    open(artifactId: ArtifactId): Promise<OpenArtifactResult>;
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
    artifacts: {
      get: async (artifactId) => {
        const payload = runtimeArtifactGetRequestSchema.parse({
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          executionId: options.executionId,
          artifactId,
        });

        const response = await postCapability(
          fetchImpl,
          options.credential,
          RUNTIME_CAPABILITY_PATHS.artifactGet,
          payload,
          timeoutMs,
        );
        const parsed = runtimeArtifactGetResponseSchema.parse(response);
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
        return parsed.artifact;
      },
      create: async (input) => {
        const form = new FormData();
        form.append("executionId", options.executionId);
        form.append("name", input.name);
        if (input.mediaType !== undefined) {
          form.append("mediaType", input.mediaType);
        }
        if (input.metadata !== undefined) {
          form.append("metadata", JSON.stringify(input.metadata));
        }
        if (input.expectedDigest !== undefined) {
          form.append("expectedDigest", input.expectedDigest);
        }
        if (input.idempotencyKey !== undefined) {
          form.append("idempotencyKey", input.idempotencyKey);
        }
        form.append("file", input.content, input.name);

        const response = await postArtifactMultipart(
          fetchImpl,
          options.credential,
          RUNTIME_CAPABILITY_PATHS.artifactCreate,
          form,
          timeoutMs,
        );
        const parsed = runtimeArtifactCreateResponseSchema.parse(response);
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
        return parsed.artifact;
      },
      open: async (artifactId) => {
        const url = new URL(
          `${options.credential.endpoint}${RUNTIME_CAPABILITY_PATHS.artifactContent}`,
        );
        url.searchParams.set("executionId", options.executionId);
        url.searchParams.set("artifactId", artifactId);

        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
        }, timeoutMs);

        let response: Response;
        try {
          response = await fetchImpl(url, {
            method: "GET",
            signal: controller.signal,
            headers: {
              authorization: options.credential.authorizationHeader(),
            },
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

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const body = await response.json();
          const parsed = runtimeArtifactCreateResponseSchema.safeParse(body);
          if (parsed.success && parsed.data.outcome === "FAILED") {
            throw new RuntimeCapabilityError(
              parsed.data.error.message,
              parsed.data.error.code,
            );
          }
          throw new RuntimeCapabilityError(
            "Artifact open failed.",
            RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
          );
        }

        if (!response.ok || response.body === null) {
          throw new RuntimeCapabilityError(
            `Artifact open failed with HTTP ${String(response.status)}.`,
            RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
          );
        }

        const digest = response.headers.get("digest") ?? "";
        const contentLength = Number(
          response.headers.get("content-length") ?? "0",
        );
        return {
          artifact: {
            id: artifactId,
            name: "",
            mediaType: contentType,
            sizeBytes: Number.isFinite(contentLength) ? contentLength : 0,
            digest,
            metadata: {},
            reference: { type: "artifact", artifactId },
          },
          stream: response.body,
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

async function postArtifactMultipart(
  fetchImpl: typeof fetch,
  credential: CapabilityCredential,
  path: string,
  form: FormData,
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
        accept: "application/json",
      },
      body: form,
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
