import type {
  ExecutionRequest,
  ExecutionResult,
  RuntimeAdapter,
} from "@osva/contracts";

export type FakeRuntimeHandler = (
  request: ExecutionRequest,
) => Promise<ExecutionResult>;

/**
 * Deterministic in-process RuntimeAdapter for tests.
 * It does not load packages, execute Agent code, call models, use Tools,
 * or access the filesystem or network.
 *
 * If the handler returns an ExecutionResult, that result is returned as-is.
 * If the handler throws, execute() rejects with the same error. Exceptions are
 * not rewritten into provider-specific ExecutionFailure codes.
 */
export class FakeRuntimeAdapter implements RuntimeAdapter {
  constructor(private readonly handler: FakeRuntimeHandler) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return await this.handler(request);
  }
}
