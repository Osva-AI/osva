import type {
  AgentRuntimeType,
  ExecutionRequest,
  ExecutionResult,
  RuntimeAdapter,
} from "@osva/contracts";

const UNSUPPORTED_RUNTIME = "UNSUPPORTED_RUNTIME";

export interface RuntimeDispatcherOptions {
  readonly executors: Readonly<
    Partial<Record<AgentRuntimeType, RuntimeAdapter>>
  >;
}

/**
 * Selects a RuntimeAdapter from the immutable AgentVersion runtime binding.
 * Runtime choice is never taken from workflow node configuration.
 */
export class RuntimeDispatcher implements RuntimeAdapter {
  private readonly executors: Readonly<
    Partial<Record<AgentRuntimeType, RuntimeAdapter>>
  >;

  constructor(options: RuntimeDispatcherOptions) {
    this.executors = options.executors;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const executor = this.executors[request.runtime.type];
    if (executor === undefined) {
      return {
        status: "failed",
        error: {
          code: UNSUPPORTED_RUNTIME,
          message: `No runtime executor is registered for ${request.runtime.type}.`,
        },
      };
    }

    return executor.execute(request);
  }

  async close(): Promise<void> {
    const seen = new Set<RuntimeAdapter>();
    for (const executor of Object.values(this.executors)) {
      if (executor === undefined || seen.has(executor)) {
        continue;
      }
      seen.add(executor);
      if (isClosableRuntime(executor)) {
        await executor.close();
      }
    }
  }
}

function isClosableRuntime(
  value: RuntimeAdapter,
): value is RuntimeAdapter & { close(): Promise<void> } {
  return (
    "close" in value &&
    typeof (value as { close?: unknown }).close === "function"
  );
}
