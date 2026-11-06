import type {
  DeclarativeAgentRuntime,
  ExecutionRequest,
  ExecutionResult,
  GenerateCompletionRequest,
  GenerateCompletionResult,
  JsonSchemaRecord,
  JsonValue,
  ModelToolDefinition,
  RunAttemptId,
  RunOperationIdempotencyClass,
  RuntimeAdapter,
  ToolInvokeRequest,
  ToolVersionId,
} from "@osva-ai/contracts";
import {
  DECLARATIVE_AGENT_CONFIG_VERSION,
  MODEL_ERROR_CODES,
  isDeclarativeAgentRuntime,
} from "@osva-ai/contracts";

import {
  AGENT_OUTPUT_SCHEMA_EFFECTIVE_CONFIG_KEY,
  DeclarativeRuntimeErrorCode,
} from "./constants.js";
import type {
  DeclarativeRuntimeKnowledgeGateway,
  DeclarativeRuntimeMemoryGateway,
} from "./declarative-context-prefetch.js";
import {
  executionFailure,
  sanitizePublicErrorMessage,
} from "./public-error.js";
import { runDeclarativeExecutionLoop } from "./declarative-run-loop.js";

export interface DeclarativeRuntimeLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, error: unknown): void;
}

export interface DeclarativeToolMetadata {
  readonly inputSchema: JsonSchemaRecord;
  readonly description?: string;
  readonly idempotencyClass: RunOperationIdempotencyClass;
}

export interface DeclarativeRuntimeModelGateway {
  generateCompletion(
    request: GenerateCompletionRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GenerateCompletionResult>;
}

export interface DeclarativeRuntimeToolGateway {
  invoke(request: ToolInvokeRequest): Promise<JsonValue>;
}

export interface DeclarativeRuntimeAdapterOptions {
  readonly logger?: DeclarativeRuntimeLogger;
  readonly modelGateway?: DeclarativeRuntimeModelGateway;
  readonly toolGateway?: DeclarativeRuntimeToolGateway;
  readonly createScopedModelGateway?: (
    execution: ExecutionRequest,
  ) => DeclarativeRuntimeModelGateway | undefined;
  readonly createScopedToolGateway?: (
    execution: ExecutionRequest,
  ) => DeclarativeRuntimeToolGateway | undefined;
  readonly createScopedKnowledgeGateway?: (
    execution: ExecutionRequest,
  ) => DeclarativeRuntimeKnowledgeGateway | undefined;
  readonly createScopedMemoryGateway?: (
    execution: ExecutionRequest,
  ) => DeclarativeRuntimeMemoryGateway | undefined;
  readonly resolveToolMetadata: (input: {
    readonly toolVersionId: ToolVersionId;
  }) => Promise<DeclarativeToolMetadata | null>;
}

interface LiveExecution {
  readonly abort: AbortController;
  readonly markCancelled: () => void;
}

export class DeclarativeRuntimeAdapter implements RuntimeAdapter {
  private readonly logger: DeclarativeRuntimeLogger | undefined;
  private readonly modelGateway: DeclarativeRuntimeModelGateway | undefined;
  private readonly toolGateway: DeclarativeRuntimeToolGateway | undefined;
  private readonly createScopedModelGateway:
    | ((
        execution: ExecutionRequest,
      ) => DeclarativeRuntimeModelGateway | undefined)
    | undefined;
  private readonly createScopedToolGateway:
    | ((
        execution: ExecutionRequest,
      ) => DeclarativeRuntimeToolGateway | undefined)
    | undefined;
  private readonly createScopedKnowledgeGateway:
    | ((
        execution: ExecutionRequest,
      ) => DeclarativeRuntimeKnowledgeGateway | undefined)
    | undefined;
  private readonly createScopedMemoryGateway:
    | ((
        execution: ExecutionRequest,
      ) => DeclarativeRuntimeMemoryGateway | undefined)
    | undefined;
  private readonly resolveToolMetadata: DeclarativeRuntimeAdapterOptions["resolveToolMetadata"];
  private readonly liveExecutions = new Map<RunAttemptId, LiveExecution>();

  constructor(options: DeclarativeRuntimeAdapterOptions) {
    this.logger = options.logger;
    this.modelGateway = options.modelGateway;
    this.toolGateway = options.toolGateway;
    this.createScopedModelGateway = options.createScopedModelGateway;
    this.createScopedToolGateway = options.createScopedToolGateway;
    this.createScopedKnowledgeGateway = options.createScopedKnowledgeGateway;
    this.createScopedMemoryGateway = options.createScopedMemoryGateway;
    this.resolveToolMetadata = options.resolveToolMetadata;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (!isDeclarativeAgentRuntime(request.runtime)) {
      return executionFailure(
        DeclarativeRuntimeErrorCode.INVALID_DESCRIPTOR,
        "Execution request runtime is not DECLARATIVE.",
      );
    }

    const runtime = request.runtime;
    if (runtime.config.configVersion !== DECLARATIVE_AGENT_CONFIG_VERSION) {
      return executionFailure(
        DeclarativeRuntimeErrorCode.INVALID_DESCRIPTOR,
        "Unsupported declarative runtime config version.",
      );
    }

    const config = runtime.config;
    const modelProfileVersionId =
      request.modelProfileVersionBindings[config.modelBinding];
    if (modelProfileVersionId === undefined) {
      return executionFailure(
        DeclarativeRuntimeErrorCode.BINDING_MISMATCH,
        "Required model binding is missing from effective bindings.",
      );
    }

    const allowedTools = new Set<string>(config.allowedToolBindings);
    for (const binding of config.allowedToolBindings) {
      if (request.toolVersionBindings[binding] === undefined) {
        return executionFailure(
          DeclarativeRuntimeErrorCode.BINDING_MISMATCH,
          `Tool binding '${binding}' is missing from effective bindings.`,
        );
      }
    }

    const outputSchema = readOutputSchema(request);
    if (outputSchema === undefined) {
      return executionFailure(
        DeclarativeRuntimeErrorCode.INVALID_DESCRIPTOR,
        "Agent output schema is unavailable for validation.",
      );
    }

    const modelGateway =
      this.createScopedModelGateway?.(request) ?? this.modelGateway;
    if (modelGateway === undefined) {
      return executionFailure(
        DeclarativeRuntimeErrorCode.MODEL_UNAVAILABLE,
        "Model capability is unavailable.",
      );
    }

    const toolGateway =
      this.createScopedToolGateway?.(request) ?? this.toolGateway;

    const knowledgeGateway = this.createScopedKnowledgeGateway?.(request);
    const memoryGateway = this.createScopedMemoryGateway?.(request);

    const abort = new AbortController();
    let cancelledByOperator = false;
    this.liveExecutions.set(request.runAttemptId, {
      abort,
      markCancelled: () => {
        cancelledByOperator = true;
      },
    });
    const timeout = setTimeout(() => abort.abort(), request.timeoutMs);

    try {
      return await this.runLoop({
        request,
        config,
        modelProfileVersionId,
        allowedTools,
        outputSchema,
        modelGateway,
        toolGateway,
        knowledgeGateway,
        memoryGateway,
        signal: abort.signal,
      });
    } catch (error) {
      if (abort.signal.aborted) {
        return executionFailure(
          cancelledByOperator
            ? DeclarativeRuntimeErrorCode.CANCELLED
            : DeclarativeRuntimeErrorCode.TIMEOUT,
          cancelledByOperator
            ? "Declarative runtime execution was cancelled."
            : "Declarative runtime execution timed out.",
        );
      }

      this.logger?.error("declarative.runtime_execute_failed", error);
      const mapped = mapThrownError(error);
      return executionFailure(mapped.code, mapped.message);
    } finally {
      clearTimeout(timeout);
      this.liveExecutions.delete(request.runAttemptId);
    }
  }

  async cancel(runAttemptId: RunAttemptId): Promise<void> {
    const live = this.liveExecutions.get(runAttemptId);
    live?.markCancelled();
    live?.abort.abort();
  }

  private async runLoop(input: {
    readonly request: ExecutionRequest;
    readonly config: DeclarativeAgentRuntime["config"];
    readonly modelProfileVersionId: GenerateCompletionRequest["modelProfileVersionId"];
    readonly allowedTools: ReadonlySet<string>;
    readonly outputSchema: JsonSchemaRecord;
    readonly modelGateway: DeclarativeRuntimeModelGateway;
    readonly toolGateway: DeclarativeRuntimeToolGateway | undefined;
    readonly knowledgeGateway: DeclarativeRuntimeKnowledgeGateway | undefined;
    readonly memoryGateway: DeclarativeRuntimeMemoryGateway | undefined;
    readonly signal: AbortSignal;
  }): Promise<ExecutionResult> {
    const {
      request,
      config,
      modelProfileVersionId,
      allowedTools,
      outputSchema,
      modelGateway,
      toolGateway,
      knowledgeGateway,
      memoryGateway,
      signal,
    } = input;

    const toolDefinitions = await this.buildToolDefinitions(
      request,
      allowedTools,
    );

    return runDeclarativeExecutionLoop({
      request,
      config,
      modelProfileVersionId,
      allowedTools,
      outputSchema,
      modelGateway,
      toolGateway,
      knowledgeGateway,
      memoryGateway,
      signal,
      toolDefinitions,
      resolveToolMetadata: (meta) => this.resolveToolMetadata(meta),
      logger: this.logger,
    });
  }

  private async buildToolDefinitions(
    request: ExecutionRequest,
    allowedTools: ReadonlySet<string>,
  ): Promise<readonly ModelToolDefinition[]> {
    const definitions: ModelToolDefinition[] = [];

    for (const binding of allowedTools) {
      const toolVersionId = request.toolVersionBindings[binding];
      if (toolVersionId === undefined) {
        continue;
      }

      const metadata = await this.resolveToolMetadata({ toolVersionId });
      if (metadata === null) {
        continue;
      }

      definitions.push({
        name: binding,
        description: metadata.description,
        inputSchema: metadata.inputSchema,
      });
    }

    return definitions;
  }
}

function readOutputSchema(
  request: ExecutionRequest,
): JsonSchemaRecord | undefined {
  const candidate =
    request.effectiveConfig[AGENT_OUTPUT_SCHEMA_EFFECTIVE_CONFIG_KEY];
  if (
    candidate === undefined ||
    typeof candidate !== "object" ||
    candidate === null
  ) {
    return undefined;
  }

  return candidate as JsonSchemaRecord;
}

function mapThrownError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    if (error.message === DeclarativeRuntimeErrorCode.CANCELLED) {
      return {
        code: DeclarativeRuntimeErrorCode.CANCELLED,
        message: "Declarative runtime execution was cancelled.",
      };
    }

    const model = mapModelGatewayFailure(error);
    if (model !== undefined) {
      return model;
    }
  }

  return {
    code: DeclarativeRuntimeErrorCode.INVALID_MODEL_RESPONSE,
    message: sanitizePublicErrorMessage(
      error instanceof Error ? error.message : "Execution failed.",
      "Declarative runtime execution failed.",
    ),
  };
}

function mapModelGatewayFailure(
  error: unknown,
): { code: string; message: string } | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") {
    return undefined;
  }

  if ((Object.values(MODEL_ERROR_CODES) as readonly string[]).includes(code)) {
    return {
      code,
      message: sanitizePublicErrorMessage(
        error.message,
        "Model invocation failed.",
      ),
    };
  }

  return undefined;
}
