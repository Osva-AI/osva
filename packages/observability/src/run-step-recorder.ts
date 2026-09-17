import { randomUUID } from "node:crypto";

import type {
  ExecutionRequest,
  GenerateTextRequest,
  GenerateTextResult,
  JsonValue,
  MemoryAuthorization,
  MemoryDeleteRequest,
  MemoryGetRequest,
  MemoryListRequest,
  MemoryListResult,
  MemoryRecordView,
  MemorySetRequest,
  RunStepId,
  ToolInvokeRequest,
} from "@osva/contracts";
import {
  MEMORY_ERROR_CODES,
  MODEL_ERROR_CODES,
  TOOL_ERROR_CODES,
} from "@osva/contracts";
import type { MemoryGateway } from "@osva/contracts";
import {
  RunStep,
  estimateModelCostUsdMicros,
  type ModelProfileRepository,
  type RunRepository,
} from "@osva/domain";
import type { ModelGateway } from "@osva/model-gateway";
import type { ToolGateway } from "@osva/tool-gateway";

export interface RunStepRecorderLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, error: unknown): void;
}

export interface RunStepRecorderClock {
  now(): Date;
}

export interface RunStepRecorderIds {
  createId(): string;
}

export interface RunStepRecorderDependencies {
  readonly runs: RunRepository;
  readonly modelProfiles: ModelProfileRepository;
  readonly clock: RunStepRecorderClock;
  readonly ids: RunStepRecorderIds;
  readonly logger?: RunStepRecorderLogger;
}

export interface RuntimeMemoryGateway {
  get(
    request: MemoryGetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView>;
  set(
    request: MemorySetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView>;
  delete(
    request: MemoryDeleteRequest,
    authorization: MemoryAuthorization,
  ): Promise<void>;
  list(
    request: MemoryListRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryListResult>;
}

export interface ScopedRunStepRecorder {
  wrapModelGateway(modelGateway: ModelGateway): RuntimeModelGateway;
  wrapToolGateway(toolGateway: ToolGateway): RuntimeToolGateway;
  wrapMemoryGateway(memoryGateway: MemoryGateway): RuntimeMemoryGateway;
}

/**
 * Parent-process execution observability seam. Records RunSteps without
 * exposing persistence to the trusted runtime child.
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

export function createRunStepRecorder(
  execution: ExecutionRequest,
  deps: RunStepRecorderDependencies,
): ScopedRunStepRecorder {
  return {
    wrapModelGateway(modelGateway) {
      return new ObservabilityModelGateway(execution, deps, modelGateway);
    },
    wrapToolGateway(toolGateway) {
      return new ObservabilityToolGateway(execution, deps, toolGateway);
    },
    wrapMemoryGateway(memoryGateway) {
      return new ObservabilityMemoryGateway(execution, deps, memoryGateway);
    },
  };
}

class ObservabilityModelGateway implements RuntimeModelGateway {
  constructor(
    private readonly execution: ExecutionRequest,
    private readonly deps: RunStepRecorderDependencies,
    private readonly inner: ModelGateway,
  ) {}

  async generateText(
    request: GenerateTextRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GenerateTextResult> {
    const bindingName = findModelBindingName(
      this.execution.modelProfileVersionBindings,
      request.modelProfileVersionId,
    );
    const startedAt = this.deps.clock.now();
    const runStepId = this.deps.ids.createId() as RunStepId;

    const running = RunStep.start({
      id: runStepId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      kind: "MODEL",
      bindingName,
      startedAt,
      modelProfileVersionId: request.modelProfileVersionId,
    });

    try {
      await this.deps.runs.insertRunningRunStep(running);
    } catch (error) {
      this.deps.logger?.error("observability.run_step_start_failed", error);
    }

    this.deps.logger?.info("observability.model_step_started", {
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      runStepId,
      kind: "MODEL",
      bindingName,
    });

    try {
      const outcome = await this.inner.generateTextOutcome(request, options);
      const version = await this.deps.modelProfiles.findModelProfileVersionById(
        request.modelProfileVersionId,
      );
      const estimatedCostUsdMicros =
        outcome.usage === undefined
          ? null
          : estimateModelCostUsdMicros(
              {
                inputTokens: outcome.usage.inputTokens,
                outputTokens: outcome.usage.outputTokens,
              },
              version?.pricing,
            );

      await this.finalizeSafely(runStepId, {
        status: "SUCCEEDED",
        completedAt: this.deps.clock.now(),
        inputTokens: outcome.usage?.inputTokens,
        outputTokens: outcome.usage?.outputTokens,
        totalTokens: outcome.usage?.totalTokens,
        cachedInputTokens: outcome.usage?.cachedInputTokens,
        estimatedCostUsdMicros,
      });

      return { text: outcome.text };
    } catch (error) {
      await this.finalizeSafely(runStepId, {
        status: "FAILED",
        completedAt: this.deps.clock.now(),
        errorCode: mapModelErrorCode(error),
      });
      throw error;
    }
  }

  private async finalizeSafely(
    runStepId: RunStepId,
    finalize: Parameters<RunStep["finalize"]>[0],
  ): Promise<void> {
    try {
      await this.deps.runs.finalizeRunStep(runStepId, finalize);
      this.deps.logger?.info("observability.model_step_finalized", {
        runId: this.execution.runId,
        runAttemptId: this.execution.runAttemptId,
        runStepId,
        status: finalize.status,
      });
    } catch (error) {
      this.deps.logger?.error("observability.run_step_finalize_failed", error);
    }
  }
}

class ObservabilityToolGateway implements RuntimeToolGateway {
  constructor(
    private readonly execution: ExecutionRequest,
    private readonly deps: RunStepRecorderDependencies,
    private readonly inner: ToolGateway,
  ) {}

  async invoke(request: ToolInvokeRequest): Promise<JsonValue> {
    const startedAt = this.deps.clock.now();
    const runStepId = this.deps.ids.createId() as RunStepId;

    const running = RunStep.start({
      id: runStepId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      kind: "TOOL",
      bindingName: request.authorization.bindingName,
      startedAt,
      toolVersionId: request.toolVersionId,
    });

    try {
      await this.deps.runs.insertRunningRunStep(running);
    } catch (error) {
      this.deps.logger?.error("observability.run_step_start_failed", error);
    }

    this.deps.logger?.info("observability.tool_step_started", {
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      runStepId,
      kind: "TOOL",
      bindingName: request.authorization.bindingName,
    });

    try {
      const output = await this.inner.invoke(request);
      await this.finalizeSafely(runStepId, {
        status: "SUCCEEDED",
        completedAt: this.deps.clock.now(),
      });
      return output;
    } catch (error) {
      await this.finalizeSafely(runStepId, {
        status: "FAILED",
        completedAt: this.deps.clock.now(),
        errorCode: mapToolErrorCode(error),
      });
      throw error;
    }
  }

  private async finalizeSafely(
    runStepId: RunStepId,
    finalize: Parameters<RunStep["finalize"]>[0],
  ): Promise<void> {
    try {
      await this.deps.runs.finalizeRunStep(runStepId, finalize);
      this.deps.logger?.info("observability.tool_step_finalized", {
        runId: this.execution.runId,
        runAttemptId: this.execution.runAttemptId,
        runStepId,
        status: finalize.status,
      });
    } catch (error) {
      this.deps.logger?.error("observability.run_step_finalize_failed", error);
    }
  }
}

function findModelBindingName(
  bindings: ExecutionRequest["modelProfileVersionBindings"],
  modelProfileVersionId: GenerateTextRequest["modelProfileVersionId"],
): string {
  for (const [bindingName, versionId] of Object.entries(bindings)) {
    if (versionId === modelProfileVersionId) {
      return bindingName;
    }
  }

  return "unknown";
}

function mapModelErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  return MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR;
}

class ObservabilityMemoryGateway implements RuntimeMemoryGateway {
  constructor(
    private readonly execution: ExecutionRequest,
    private readonly deps: RunStepRecorderDependencies,
    private readonly inner: MemoryGateway,
  ) {}

  async get(
    request: MemoryGetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView> {
    return this.record("memory.get", request.bindingName, () =>
      this.inner.get(request, authorization),
    );
  }

  async set(
    request: MemorySetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView> {
    return this.record("memory.set", request.bindingName, () =>
      this.inner.set(request, authorization),
    );
  }

  async delete(
    request: MemoryDeleteRequest,
    authorization: MemoryAuthorization,
  ): Promise<void> {
    await this.record("memory.delete", request.bindingName, () =>
      this.inner.delete(request, authorization),
    );
  }

  async list(
    request: MemoryListRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryListResult> {
    return this.record("memory.list", request.bindingName, () =>
      this.inner.list(request, authorization),
    );
  }

  private async record<T>(
    operation: string,
    bindingName: string,
    invoke: () => Promise<T>,
  ): Promise<T> {
    const startedAt = this.deps.clock.now();
    const runStepId = this.deps.ids.createId() as RunStepId;

    const running = RunStep.start({
      id: runStepId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      kind: "MEMORY",
      bindingName,
      startedAt,
    });

    try {
      await this.deps.runs.insertRunningRunStep(running);
    } catch (error) {
      this.deps.logger?.error("observability.run_step_start_failed", error);
    }

    this.deps.logger?.info("observability.memory_step_started", {
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      runStepId,
      kind: "MEMORY",
      bindingName,
      operation,
    });

    try {
      const result = await invoke();
      await this.finalizeSafely(runStepId, {
        status: "SUCCEEDED",
        completedAt: this.deps.clock.now(),
      });
      return result;
    } catch (error) {
      await this.finalizeSafely(runStepId, {
        status: "FAILED",
        completedAt: this.deps.clock.now(),
        errorCode: mapMemoryErrorCode(error),
      });
      throw error;
    }
  }

  private async finalizeSafely(
    runStepId: RunStepId,
    finalize: Parameters<RunStep["finalize"]>[0],
  ): Promise<void> {
    try {
      await this.deps.runs.finalizeRunStep(runStepId, finalize);
      this.deps.logger?.info("observability.memory_step_finalized", {
        runId: this.execution.runId,
        runAttemptId: this.execution.runAttemptId,
        runStepId,
        status: finalize.status,
      });
    } catch (error) {
      this.deps.logger?.error("observability.run_step_finalize_failed", error);
    }
  }
}

function mapMemoryErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  return MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE;
}

function mapToolErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  return TOOL_ERROR_CODES.TOOL_EXECUTION_ERROR;
}

export function createRunStepRecorderIds(): RunStepRecorderIds {
  return {
    createId: () => randomUUID(),
  };
}
