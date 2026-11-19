import type {
  InferenceRoutingCircuitBreakerSettings,
  ModelProfileVersionId,
  ModelProviderConnectionVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_ROUTING_DEFAULT_CIRCUIT_BREAKER } from "@osva-ai/contracts";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitObservation {
  readonly success: boolean;
  readonly atMs: number;
  readonly retryable: boolean;
}

export interface CircuitSnapshot {
  readonly state: CircuitState;
  readonly failureCount: number;
  readonly successCount: number;
  readonly openedAtMs: number | null;
}

function circuitKey(input: {
  readonly workspaceId: WorkspaceId;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly connectionVersionId?: ModelProviderConnectionVersionId;
}): string {
  return [
    input.workspaceId,
    input.modelProfileVersionId,
    input.connectionVersionId ?? "legacy",
  ].join(":");
}

export class InferenceRoutingCircuitBreakerRegistry {
  private readonly settings: InferenceRoutingCircuitBreakerSettings;
  private readonly observations = new Map<string, CircuitObservation[]>();
  private readonly state = new Map<string, CircuitSnapshot>();

  constructor(
    settings: InferenceRoutingCircuitBreakerSettings = INFERENCE_ROUTING_DEFAULT_CIRCUIT_BREAKER,
  ) {
    this.settings = settings;
  }

  observe(input: {
    readonly workspaceId: WorkspaceId;
    readonly modelProfileVersionId: ModelProfileVersionId;
    readonly connectionVersionId?: ModelProviderConnectionVersionId;
    readonly success: boolean;
    readonly retryable: boolean;
    readonly atMs: number;
  }): void {
    const key = circuitKey(input);
    const list = this.observations.get(key) ?? [];
    list.push({
      success: input.success,
      atMs: input.atMs,
      retryable: input.retryable,
    });
    const windowStart = input.atMs - this.settings.windowMs;
    const trimmed = list.filter((row) => row.atMs >= windowStart);
    this.observations.set(key, trimmed);

    const current = this.snapshotForKey(key, input.atMs);
    const retryableFailures = trimmed.filter(
      (row) => !row.success && row.retryable,
    ).length;

    if (current.state === "OPEN") {
      if (
        input.atMs - (current.openedAtMs ?? input.atMs) >=
        this.settings.openDurationMs
      ) {
        this.state.set(key, {
          state: "HALF_OPEN",
          failureCount: retryableFailures,
          successCount: 0,
          openedAtMs: current.openedAtMs,
        });
      }
      return;
    }

    if (current.state === "HALF_OPEN") {
      if (input.success) {
        const successes = current.successCount + 1;
        const threshold = this.settings.halfOpenProbeSuccessThreshold ?? 1;
        if (successes >= threshold) {
          this.state.set(key, {
            state: "CLOSED",
            failureCount: 0,
            successCount: 0,
            openedAtMs: null,
          });
          this.observations.set(key, []);
        } else {
          this.state.set(key, {
            ...current,
            successCount: successes,
          });
        }
      } else if (input.retryable) {
        this.state.set(key, {
          state: "OPEN",
          failureCount: retryableFailures,
          successCount: 0,
          openedAtMs: input.atMs,
        });
      }
      return;
    }

    if (retryableFailures >= this.settings.failureThreshold) {
      this.state.set(key, {
        state: "OPEN",
        failureCount: retryableFailures,
        successCount: 0,
        openedAtMs: input.atMs,
      });
    } else {
      this.state.set(key, {
        state: "CLOSED",
        failureCount: retryableFailures,
        successCount: 0,
        openedAtMs: null,
      });
    }
  }

  isEligible(input: {
    readonly workspaceId: WorkspaceId;
    readonly modelProfileVersionId: ModelProfileVersionId;
    readonly connectionVersionId?: ModelProviderConnectionVersionId;
    readonly atMs: number;
  }): boolean {
    const key = circuitKey(input);
    const snap = this.snapshotForKey(key, input.atMs);
    return snap.state !== "OPEN";
  }

  snapshot(input: {
    readonly workspaceId: WorkspaceId;
    readonly modelProfileVersionId: ModelProfileVersionId;
    readonly connectionVersionId?: ModelProviderConnectionVersionId;
    readonly atMs: number;
  }): CircuitSnapshot {
    return this.snapshotForKey(circuitKey(input), input.atMs);
  }

  private snapshotForKey(key: string, atMs: number): CircuitSnapshot {
    const stored = this.state.get(key);
    if (stored === undefined) {
      return {
        state: "CLOSED",
        failureCount: 0,
        successCount: 0,
        openedAtMs: null,
      };
    }

    if (
      stored.state === "OPEN" &&
      stored.openedAtMs !== null &&
      atMs - stored.openedAtMs >= this.settings.openDurationMs
    ) {
      return {
        ...stored,
        state: "HALF_OPEN",
      };
    }

    return stored;
  }
}
