import type { RuntimeExecuteRequest } from "@osva/runtime-protocol";

interface PendingExecutionBootstrap {
  readonly request: RuntimeExecuteRequest;
  readonly expiresAtMs: number;
}

/**
 * Ephemeral in-memory store for container execution bootstrap requests.
 * Worker restart clears pending entries; queue redelivery re-registers them.
 */
export class RuntimeExecutionBootstrapStore {
  private readonly pending = new Map<string, PendingExecutionBootstrap>();

  register(
    executionId: string,
    request: RuntimeExecuteRequest,
    expiresAtMs: number,
  ): void {
    this.pending.set(executionId, { request, expiresAtMs });
  }

  /**
   * Returns and removes the pending request (single-use retrieval).
   */
  consume(
    executionId: string,
    nowMs: number,
  ): RuntimeExecuteRequest | undefined {
    const entry = this.pending.get(executionId);
    if (entry === undefined) {
      return undefined;
    }

    if (nowMs >= entry.expiresAtMs) {
      this.pending.delete(executionId);
      return undefined;
    }

    this.pending.delete(executionId);
    return entry.request;
  }

  clear(executionId: string): void {
    this.pending.delete(executionId);
  }
}

export function buildRuntimeExecutionBootstrapUrl(
  capabilityBaseUrl: string,
  executionId: string,
): string {
  const base = capabilityBaseUrl.replace(/\/$/, "");
  const path = `/v1/runtime/executions/bootstrap?executionId=${encodeURIComponent(executionId)}`;
  return `${base}${path}`;
}
