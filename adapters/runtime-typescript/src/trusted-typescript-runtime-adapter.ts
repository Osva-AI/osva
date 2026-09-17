import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";

import type {
  ExecutionRequest,
  ExecutionResult,
  GenerateTextRequest,
  GenerateTextResult,
  JsonValue,
  RuntimeAdapter,
  ToolInvokeRequest,
  TrustedTypeScriptRuntime,
} from "@osva/contracts";
import type {
  MemoryAuthorization,
  MemoryDeleteRequest,
  MemoryGetRequest,
  MemoryListRequest,
  MemorySetRequest,
} from "@osva/contracts";
import {
  MEMORY_ERROR_CODES,
  MODEL_ERROR_CODES,
  TOOL_ERROR_CODES,
  isCanonicalJsonValue,
  isSha256IntegrityDigest,
  sha256IntegrityHex,
} from "@osva/contracts";

import { createChildEnvironment } from "./child-env.js";
import { RuntimeErrorCode } from "./constants.js";
import { createTrustedAgentContext } from "./context.js";
import { integrityMatches, sha256IntegrityOf } from "./integrity.js";
import {
  executionFailure,
  sanitizePublicErrorMessage,
} from "./public-error.js";
import {
  isChildResultMessage,
  isMemoryDeleteRequestMessage,
  isMemoryGetRequestMessage,
  isMemoryListRequestMessage,
  isMemorySetRequestMessage,
  isModelGenerateRequestMessage,
  isToolInvokeRequestMessage,
  type ExecuteChildRequest,
  type MemoryDeleteRequestMessage,
  type MemoryGetRequestMessage,
  type MemoryListRequestMessage,
  type MemorySetRequestMessage,
  type ModelGenerateRequestMessage,
  type ToolInvokeRequestMessage,
} from "./protocol.js";
import {
  childPermissionExecArgv,
  resolveChildRunnerPath,
} from "./readiness.js";
import {
  resolveTrustedEntrypoint,
  resolveTrustedRuntimeRoot,
  TrustedPathError,
} from "./trusted-path.js";

export interface TrustedTypeScriptRuntimeLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, error: unknown): void;
}

export interface TrustedTypeScriptRuntimeAdapterOptions {
  readonly trustedRuntimeRoot: string;
  readonly logger?: TrustedTypeScriptRuntimeLogger;
  readonly enablePermissionModel?: boolean;
  readonly modelGateway?: RuntimeModelGateway;
  readonly toolGateway?: RuntimeToolGateway;
  readonly createScopedModelGateway?: (
    execution: ExecutionRequest,
  ) => RuntimeModelGateway | undefined;
  readonly createScopedToolGateway?: (
    execution: ExecutionRequest,
  ) => RuntimeToolGateway | undefined;
  readonly memoryGateway?: RuntimeMemoryGateway;
  readonly createScopedMemoryGateway?: (
    execution: ExecutionRequest,
  ) => RuntimeMemoryGateway | undefined;
}

export interface RuntimeMemoryGateway {
  get(
    request: MemoryGetRequest,
    authorization: MemoryAuthorization,
  ): Promise<{
    readonly key: string;
    readonly value: JsonValue;
    readonly revision: number;
  }>;
  set(
    request: MemorySetRequest,
    authorization: MemoryAuthorization,
  ): Promise<{
    readonly key: string;
    readonly value: JsonValue;
    readonly revision: number;
  }>;
  delete(
    request: MemoryDeleteRequest,
    authorization: MemoryAuthorization,
  ): Promise<void>;
  list(
    request: MemoryListRequest,
    authorization: MemoryAuthorization,
  ): Promise<{
    readonly items: readonly {
      readonly key: string;
      readonly value: JsonValue;
      readonly revision: number;
    }[];
    readonly nextCursor?: string;
  }>;
}

/**
 * Execution-plane ModelGateway. AbortSignal is passed separately from the
 * public GenerateTextRequest contract and is never placed on runtime IPC.
 */
export interface RuntimeModelGateway {
  generateText(
    request: GenerateTextRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GenerateTextResult>;
}

export interface RuntimeToolGateway {
  invoke(request: ToolInvokeRequest): Promise<JsonValue>;
}

interface LiveExecution {
  readonly child: ChildProcess;
  readonly abort: AbortController;
}

export class TrustedTypeScriptRuntimeAdapter implements RuntimeAdapter {
  private readonly trustedRuntimeRoot: string;
  private readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
  private readonly enablePermissionModel: boolean;
  private readonly modelGateway: RuntimeModelGateway | undefined;
  private readonly toolGateway: RuntimeToolGateway | undefined;
  private readonly createScopedModelGateway:
    | ((execution: ExecutionRequest) => RuntimeModelGateway | undefined)
    | undefined;
  private readonly createScopedToolGateway:
    | ((execution: ExecutionRequest) => RuntimeToolGateway | undefined)
    | undefined;
  private readonly memoryGateway: RuntimeMemoryGateway | undefined;
  private readonly createScopedMemoryGateway:
    | ((execution: ExecutionRequest) => RuntimeMemoryGateway | undefined)
    | undefined;
  private readonly liveExecutions = new Set<LiveExecution>();
  private closed = false;

  constructor(options: TrustedTypeScriptRuntimeAdapterOptions) {
    this.trustedRuntimeRoot = options.trustedRuntimeRoot;
    this.logger = options.logger;
    this.enablePermissionModel = options.enablePermissionModel ?? true;
    this.modelGateway = options.modelGateway;
    this.toolGateway = options.toolGateway;
    this.createScopedModelGateway = options.createScopedModelGateway;
    this.createScopedToolGateway = options.createScopedToolGateway;
    this.memoryGateway = options.memoryGateway;
    this.createScopedMemoryGateway = options.createScopedMemoryGateway;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (this.closed) {
      return executionFailure(
        RuntimeErrorCode.INVALID_MODULE,
        "Trusted TypeScript runtime has been closed.",
      );
    }

    const prepared = await this.prepare(request);
    if (prepared.status !== "ready") {
      return prepared;
    }

    return this.runChild(request, prepared.modulePath, prepared.rootReal);
  }

  async close(): Promise<void> {
    this.closed = true;
    const executions = [...this.liveExecutions];
    this.liveExecutions.clear();
    await Promise.all(
      executions.map(async (execution) => {
        execution.abort.abort();
        await terminateChild(execution.child);
      }),
    );
  }

  private async prepare(request: ExecutionRequest): Promise<
    | ExecutionResult
    | {
        readonly status: "ready";
        readonly modulePath: string;
        readonly rootReal: string;
      }
  > {
    const runtime = request.runtime;
    if (!isTrustedTypeScriptRuntime(runtime)) {
      return executionFailure(
        RuntimeErrorCode.INVALID_DESCRIPTOR,
        "AgentVersion runtime descriptor is not a trusted TypeScript runtime.",
      );
    }

    if (!isSha256IntegrityDigest(runtime.integrity)) {
      return executionFailure(
        RuntimeErrorCode.INVALID_DESCRIPTOR,
        "AgentVersion runtime integrity must be a sha256 digest.",
      );
    }

    try {
      const rootReal = await resolveTrustedRuntimeRoot(this.trustedRuntimeRoot);
      const modulePath = await resolveTrustedEntrypoint(
        rootReal,
        runtime.entrypoint,
      );
      const artifact = await fs.readFile(modulePath);
      const actual = sha256IntegrityOf(artifact);
      const expectedHex = sha256IntegrityHex(runtime.integrity);
      if (
        expectedHex === undefined ||
        !integrityMatches(runtime.integrity, actual)
      ) {
        this.logger?.info("runtime.integrity_mismatch", {
          entrypoint: runtime.entrypoint,
        });
        return executionFailure(
          RuntimeErrorCode.INTEGRITY_MISMATCH,
          "Trusted runtime artifact integrity does not match the AgentVersion digest.",
        );
      }

      return { status: "ready", modulePath, rootReal };
    } catch (error) {
      if (error instanceof TrustedPathError) {
        return executionFailure(error.code, error.message);
      }

      this.logger?.error("runtime.prepare_failed", error);
      return executionFailure(
        RuntimeErrorCode.ARTIFACT_NOT_FOUND,
        "Trusted runtime entrypoint was not found.",
      );
    }
  }

  private async runChild(
    request: ExecutionRequest,
    modulePath: string,
    rootReal: string,
  ): Promise<ExecutionResult> {
    const childRunnerPath = resolveChildRunnerPath();
    const execArgv = this.enablePermissionModel
      ? childPermissionExecArgv(rootReal, childRunnerPath)
      : [];

    const child = fork(childRunnerPath, [], {
      cwd: rootReal,
      env: createChildEnvironment(),
      execArgv,
      serialization: "json",
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const abort = new AbortController();
    const live: LiveExecution = { child, abort };
    this.liveExecutions.add(live);

    const ipcRequest: ExecuteChildRequest = {
      v: 1,
      type: "execute",
      modulePath,
      context: createTrustedAgentContext(request),
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      this.logger?.info("runtime.child_stdout", {
        bytes: chunk.length,
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.logger?.info("runtime.child_stderr", {
        bytes: chunk.length,
      });
    });

    try {
      return await waitForChildResult({
        child,
        request: ipcRequest,
        timeoutMs: request.timeoutMs,
        abort,
        modelGateway:
          this.createScopedModelGateway?.(request) ?? this.modelGateway,
        toolGateway:
          this.createScopedToolGateway?.(request) ?? this.toolGateway,
        memoryGateway:
          this.createScopedMemoryGateway?.(request) ?? this.memoryGateway,
        modelBindings: request.modelProfileVersionBindings,
        toolBindings: request.toolVersionBindings,
        execution: request,
        logger: this.logger,
      });
    } finally {
      abort.abort();
      this.liveExecutions.delete(live);
      await terminateChild(child);
    }
  }
}

function isTrustedTypeScriptRuntime(
  runtime: ExecutionRequest["runtime"],
): runtime is TrustedTypeScriptRuntime {
  return runtime.type === "TRUSTED_TYPESCRIPT";
}

function waitForChildResult(options: {
  readonly child: ChildProcess;
  readonly request: ExecuteChildRequest;
  readonly timeoutMs: number;
  readonly abort: AbortController;
  readonly modelGateway: RuntimeModelGateway | undefined;
  readonly toolGateway: RuntimeToolGateway | undefined;
  readonly memoryGateway: RuntimeMemoryGateway | undefined;
  readonly modelBindings: ExecutionRequest["modelProfileVersionBindings"];
  readonly toolBindings: ExecutionRequest["toolVersionBindings"];
  readonly execution: ExecutionRequest;
  readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
}): Promise<ExecutionResult> {
  const {
    child,
    request,
    timeoutMs,
    abort,
    modelGateway,
    toolGateway,
    memoryGateway,
    modelBindings,
    toolBindings,
    execution,
    logger,
  } = options;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: ExecutionResult) => {
      if (settled) {
        return;
      }
      settled = true;
      abort.abort();
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        executionFailure(
          RuntimeErrorCode.TIMEOUT,
          "Trusted runtime execution timed out.",
        ),
      );
    }, timeoutMs);

    const onMessage = (raw: unknown) => {
      if (isModelGenerateRequestMessage(raw)) {
        void handleModelGenerateRequest({
          child,
          message: raw,
          abort,
          modelGateway,
          bindings: modelBindings,
          logger,
          isSettled: () => settled,
        });
        return;
      }

      if (isToolInvokeRequestMessage(raw)) {
        void handleToolInvokeRequest({
          child,
          message: raw,
          abort,
          toolGateway,
          bindings: toolBindings,
          execution,
          logger,
          isSettled: () => settled,
        });
        return;
      }

      if (isMemoryGetRequestMessage(raw)) {
        void handleMemoryGetRequest({
          child,
          message: raw,
          memoryGateway,
          execution,
          logger,
          isSettled: () => settled,
        });
        return;
      }

      if (isMemorySetRequestMessage(raw)) {
        void handleMemorySetRequest({
          child,
          message: raw,
          memoryGateway,
          execution,
          logger,
          isSettled: () => settled,
        });
        return;
      }

      if (isMemoryDeleteRequestMessage(raw)) {
        void handleMemoryDeleteRequest({
          child,
          message: raw,
          memoryGateway,
          execution,
          logger,
          isSettled: () => settled,
        });
        return;
      }

      if (isMemoryListRequestMessage(raw)) {
        void handleMemoryListRequest({
          child,
          message: raw,
          memoryGateway,
          execution,
          logger,
          isSettled: () => settled,
        });
        return;
      }

      if (!isChildResultMessage(raw)) {
        finish(
          executionFailure(
            RuntimeErrorCode.INVALID_MODULE,
            "Trusted runtime returned an invalid execution result.",
          ),
        );
        return;
      }

      if (raw.type === "succeeded") {
        if (!isCanonicalJsonValue(raw.output)) {
          finish(
            executionFailure(
              RuntimeErrorCode.INVALID_OUTPUT,
              "Trusted runtime output is not JSON-compatible.",
            ),
          );
          return;
        }

        finish({ status: "succeeded", output: raw.output });
        return;
      }

      finish({
        status: "failed",
        error: {
          code: raw.error.code,
          message: raw.error.message,
        },
      });
    };

    const onExit = (code: number | null) => {
      finish(
        executionFailure(
          RuntimeErrorCode.AGENT_ERROR,
          code === 0
            ? "Trusted agent process exited before returning a result."
            : "Trusted agent process terminated before returning a result.",
        ),
      );
    };

    const onError = () => {
      finish(
        executionFailure(
          RuntimeErrorCode.AGENT_ERROR,
          "Trusted agent process failed to start.",
        ),
      );
    };

    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);

    const sent = child.send(request);
    if (!sent) {
      finish(
        executionFailure(
          RuntimeErrorCode.AGENT_ERROR,
          "Trusted agent process failed to start.",
        ),
      );
    }
  });
}

async function handleModelGenerateRequest(options: {
  readonly child: ChildProcess;
  readonly message: ModelGenerateRequestMessage;
  readonly abort: AbortController;
  readonly modelGateway: RuntimeModelGateway | undefined;
  readonly bindings: ExecutionRequest["modelProfileVersionBindings"];
  readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
  readonly isSettled: () => boolean;
}): Promise<void> {
  const { child, message, abort, modelGateway, bindings, logger, isSettled } =
    options;

  const sendFailure = (code: string, errorMessage: string) => {
    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "model.generate.failed",
      callId: message.callId,
      error: {
        code,
        message: sanitizePublicErrorMessage(
          errorMessage,
          "Model generation failed.",
        ),
      },
    });
  };

  const modelProfileVersionId = bindings[message.binding];
  if (modelProfileVersionId === undefined) {
    sendFailure(
      MODEL_ERROR_CODES.MODEL_BINDING_NOT_FOUND,
      "Model binding was not found.",
    );
    return;
  }

  if (modelGateway === undefined) {
    sendFailure(
      MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE,
      "The configured model provider is unavailable.",
    );
    return;
  }

  try {
    const result = await modelGateway.generateText(
      {
        modelProfileVersionId,
        messages: message.request.messages,
        maxOutputTokens: message.request.maxOutputTokens,
      },
      { signal: abort.signal },
    );

    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "model.generate.succeeded",
      callId: message.callId,
      result,
    });
  } catch (error) {
    logger?.error("runtime.model_generate_failed", error);
    const mapped = mapModelGatewayFailure(error);
    sendFailure(mapped.code, mapped.message);
  }
}

async function handleToolInvokeRequest(options: {
  readonly child: ChildProcess;
  readonly message: ToolInvokeRequestMessage;
  readonly abort: AbortController;
  readonly toolGateway: RuntimeToolGateway | undefined;
  readonly bindings: ExecutionRequest["toolVersionBindings"];
  readonly execution: ExecutionRequest;
  readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
  readonly isSettled: () => boolean;
}): Promise<void> {
  const {
    child,
    message,
    toolGateway,
    bindings,
    execution,
    logger,
    isSettled,
  } = options;

  const sendFailure = (code: string, errorMessage: string) => {
    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "tool.invoke.failed",
      callId: message.callId,
      error: {
        code,
        message: sanitizePublicErrorMessage(
          errorMessage,
          "Tool invocation failed.",
        ),
      },
    });
  };

  const toolVersionId = bindings[message.binding];
  if (toolVersionId === undefined) {
    sendFailure(
      TOOL_ERROR_CODES.TOOL_BINDING_NOT_FOUND,
      "Tool binding was not found.",
    );
    return;
  }

  if (toolGateway === undefined) {
    sendFailure(
      TOOL_ERROR_CODES.TOOL_EXECUTION_ERROR,
      "Tool capability is unavailable.",
    );
    return;
  }

  try {
    const output = await toolGateway.invoke({
      toolVersionId,
      input: message.input,
      idempotencyKey: message.idempotencyKey,
      authorization: {
        workspaceId: execution.workspaceId,
        agentId: execution.agentId,
        runId: execution.runId,
        runAttemptId: execution.runAttemptId,
        bindingName: message.binding,
        toolVersionId,
      },
    });

    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "tool.invoke.succeeded",
      callId: message.callId,
      output,
    });
  } catch (error) {
    logger?.error("runtime.tool_invoke_failed", error);
    const mapped = mapToolGatewayFailure(error);
    sendFailure(mapped.code, mapped.message);
  }
}

function memoryAuthorization(execution: ExecutionRequest): MemoryAuthorization {
  return {
    workspaceId: execution.workspaceId,
    memoryNamespaceBindings: execution.memoryNamespaceBindings,
    allowPersistentMutation: execution.evaluationContext === undefined,
  };
}

async function handleMemoryGetRequest(options: {
  readonly child: ChildProcess;
  readonly message: MemoryGetRequestMessage;
  readonly memoryGateway: RuntimeMemoryGateway | undefined;
  readonly execution: ExecutionRequest;
  readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
  readonly isSettled: () => boolean;
}): Promise<void> {
  const { child, message, memoryGateway, execution, logger, isSettled } =
    options;

  const sendFailure = (code: string, errorMessage: string) => {
    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "memory.get.failed",
      callId: message.callId,
      error: {
        code,
        message: sanitizePublicErrorMessage(errorMessage, "Memory get failed."),
      },
    });
  };

  if (memoryGateway === undefined) {
    sendFailure(
      MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
      "Memory capability is unavailable.",
    );
    return;
  }

  try {
    const record = await memoryGateway.get(
      { bindingName: message.binding, key: message.key },
      memoryAuthorization(execution),
    );

    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "memory.get.succeeded",
      callId: message.callId,
      record,
    });
  } catch (error) {
    logger?.error("runtime.memory_get_failed", error);
    const mapped = mapMemoryGatewayFailure(error);
    sendFailure(mapped.code, mapped.message);
  }
}

async function handleMemorySetRequest(options: {
  readonly child: ChildProcess;
  readonly message: MemorySetRequestMessage;
  readonly memoryGateway: RuntimeMemoryGateway | undefined;
  readonly execution: ExecutionRequest;
  readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
  readonly isSettled: () => boolean;
}): Promise<void> {
  const { child, message, memoryGateway, execution, logger, isSettled } =
    options;

  const sendFailure = (code: string, errorMessage: string) => {
    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "memory.set.failed",
      callId: message.callId,
      error: {
        code,
        message: sanitizePublicErrorMessage(errorMessage, "Memory set failed."),
      },
    });
  };

  if (memoryGateway === undefined) {
    sendFailure(
      MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
      "Memory capability is unavailable.",
    );
    return;
  }

  try {
    const record = await memoryGateway.set(
      {
        bindingName: message.binding,
        key: message.key,
        value: message.value,
        expectedRevision: message.expectedRevision,
      },
      memoryAuthorization(execution),
    );

    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "memory.set.succeeded",
      callId: message.callId,
      record,
    });
  } catch (error) {
    logger?.error("runtime.memory_set_failed", error);
    const mapped = mapMemoryGatewayFailure(error);
    sendFailure(mapped.code, mapped.message);
  }
}

async function handleMemoryDeleteRequest(options: {
  readonly child: ChildProcess;
  readonly message: MemoryDeleteRequestMessage;
  readonly memoryGateway: RuntimeMemoryGateway | undefined;
  readonly execution: ExecutionRequest;
  readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
  readonly isSettled: () => boolean;
}): Promise<void> {
  const { child, message, memoryGateway, execution, logger, isSettled } =
    options;

  const sendFailure = (code: string, errorMessage: string) => {
    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "memory.delete.failed",
      callId: message.callId,
      error: {
        code,
        message: sanitizePublicErrorMessage(
          errorMessage,
          "Memory delete failed.",
        ),
      },
    });
  };

  if (memoryGateway === undefined) {
    sendFailure(
      MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
      "Memory capability is unavailable.",
    );
    return;
  }

  try {
    await memoryGateway.delete(
      {
        bindingName: message.binding,
        key: message.key,
        expectedRevision: message.expectedRevision,
      },
      memoryAuthorization(execution),
    );

    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "memory.delete.succeeded",
      callId: message.callId,
    });
  } catch (error) {
    logger?.error("runtime.memory_delete_failed", error);
    const mapped = mapMemoryGatewayFailure(error);
    sendFailure(mapped.code, mapped.message);
  }
}

async function handleMemoryListRequest(options: {
  readonly child: ChildProcess;
  readonly message: MemoryListRequestMessage;
  readonly memoryGateway: RuntimeMemoryGateway | undefined;
  readonly execution: ExecutionRequest;
  readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
  readonly isSettled: () => boolean;
}): Promise<void> {
  const { child, message, memoryGateway, execution, logger, isSettled } =
    options;

  const sendFailure = (code: string, errorMessage: string) => {
    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "memory.list.failed",
      callId: message.callId,
      error: {
        code,
        message: sanitizePublicErrorMessage(
          errorMessage,
          "Memory list failed.",
        ),
      },
    });
  };

  if (memoryGateway === undefined) {
    sendFailure(
      MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
      "Memory capability is unavailable.",
    );
    return;
  }

  try {
    const result = await memoryGateway.list(
      {
        bindingName: message.binding,
        prefix: message.prefix,
        limit: message.limit,
        cursor: message.cursor,
      },
      memoryAuthorization(execution),
    );

    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "memory.list.succeeded",
      callId: message.callId,
      items: result.items,
      ...(result.nextCursor === undefined
        ? {}
        : { nextCursor: result.nextCursor }),
    });
  } catch (error) {
    logger?.error("runtime.memory_list_failed", error);
    const mapped = mapMemoryGatewayFailure(error);
    sendFailure(mapped.code, mapped.message);
  }
}

function mapMemoryGatewayFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    const message =
      error instanceof Error ? error.message : "Memory operation failed.";
    return {
      code: error.code,
      message: sanitizePublicErrorMessage(message, "Memory operation failed."),
    };
  }

  return {
    code: MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE,
    message: "Memory operation failed.",
  };
}

function mapToolGatewayFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    const message =
      error instanceof Error ? error.message : "Tool invocation failed.";
    return {
      code: error.code,
      message: sanitizePublicErrorMessage(message, "Tool invocation failed."),
    };
  }

  return {
    code: TOOL_ERROR_CODES.TOOL_EXECUTION_ERROR,
    message: "Tool invocation failed.",
  };
}

function mapModelGatewayFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    const message =
      error instanceof Error ? error.message : "Model generation failed.";
    return {
      code: error.code,
      message: sanitizePublicErrorMessage(message, "Model generation failed."),
    };
  }

  return {
    code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
    message: "Model generation failed.",
  };
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill("SIGKILL");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => {
      resolve();
    });
    setTimeout(resolve, 1_000).unref();
  });
}
