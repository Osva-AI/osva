import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";

import type {
  ExecutionRequest,
  ExecutionResult,
  GenerateTextRequest,
  GenerateTextResult,
  RuntimeAdapter,
  TrustedTypeScriptRuntime,
} from "@osva/contracts";
import {
  MODEL_ERROR_CODES,
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
  isModelGenerateRequestMessage,
  type ExecuteChildRequest,
  type ModelGenerateRequestMessage,
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

interface LiveExecution {
  readonly child: ChildProcess;
  readonly abort: AbortController;
}

export class TrustedTypeScriptRuntimeAdapter implements RuntimeAdapter {
  private readonly trustedRuntimeRoot: string;
  private readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
  private readonly enablePermissionModel: boolean;
  private readonly modelGateway: RuntimeModelGateway | undefined;
  private readonly liveExecutions = new Set<LiveExecution>();
  private closed = false;

  constructor(options: TrustedTypeScriptRuntimeAdapterOptions) {
    this.trustedRuntimeRoot = options.trustedRuntimeRoot;
    this.logger = options.logger;
    this.enablePermissionModel = options.enablePermissionModel ?? true;
    this.modelGateway = options.modelGateway;
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
        modelGateway: this.modelGateway,
        bindings: request.modelProfileVersionBindings,
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
  readonly bindings: ExecutionRequest["modelProfileVersionBindings"];
  readonly logger: TrustedTypeScriptRuntimeLogger | undefined;
}): Promise<ExecutionResult> {
  const { child, request, timeoutMs, abort, modelGateway, bindings, logger } =
    options;

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
          bindings,
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
