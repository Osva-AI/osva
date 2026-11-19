import type {
  InferenceRoutingLatencyObservation,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_ROUTING_LATENCY_MIN_SAMPLES } from "@osva-ai/contracts";

interface LatencySample {
  readonly completionMs: number;
  readonly atMs: number;
}

const MAX_SAMPLES_PER_KEY = 64;

function latencyKey(
  workspaceId: WorkspaceId,
  modelProfileVersionId: ModelProfileVersionId,
): string {
  return `${workspaceId}:${modelProfileVersionId}`;
}

export class InferenceRoutingLatencyStore {
  private readonly samples = new Map<string, LatencySample[]>();

  record(input: {
    readonly workspaceId: WorkspaceId;
    readonly modelProfileVersionId: ModelProfileVersionId;
    readonly completionMs: number;
    readonly atMs: number;
  }): void {
    const key = latencyKey(input.workspaceId, input.modelProfileVersionId);
    const list = this.samples.get(key) ?? [];
    list.push({ completionMs: input.completionMs, atMs: input.atMs });
    this.samples.set(key, list.slice(-MAX_SAMPLES_PER_KEY));
  }

  observe(
    workspaceId: WorkspaceId,
    modelProfileVersionId: ModelProfileVersionId,
  ): InferenceRoutingLatencyObservation {
    const list = this.samples.get(
      latencyKey(workspaceId, modelProfileVersionId),
    );
    if (list === undefined || list.length === 0) {
      return {
        sampleCount: 0,
        medianCompletionMs: null,
        sufficientEvidence: false,
      };
    }

    const sorted = [...list]
      .map((row) => row.completionMs)
      .sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
        : sorted[mid]!;

    return {
      sampleCount: list.length,
      medianCompletionMs: median,
      sufficientEvidence: list.length >= INFERENCE_ROUTING_LATENCY_MIN_SAMPLES,
    };
  }
}
