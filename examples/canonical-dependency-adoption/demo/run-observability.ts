import type {
  RunAttemptId,
  RunId,
  RunStepKind,
  RunStepStatus,
  ToolVersionId,
  ToolVersionResourceV1,
} from "@osva-ai/contracts";
import {
  runStepListResourceSchema,
  toolVersionResourceSchema,
} from "@osva-ai/contracts/schemas";
import type { OsvaHttpClient } from "@osva-ai/sdk";

export interface RunStepResource {
  readonly id: string;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly kind: RunStepKind;
  readonly bindingName: string;
  readonly status: RunStepStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly modelProfileVersionId?: string;
  readonly toolVersionId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly estimatedCostUsdMicros?: number | null;
  readonly errorCode?: string;
}

type ToolVersionResource = ToolVersionResourceV1;

export async function listAllRunSteps(
  http: OsvaHttpClient,
  runId: RunId,
  runAttemptId: RunAttemptId,
): Promise<readonly RunStepResource[]> {
  const steps: RunStepResource[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = runStepListResourceSchema.parse(
      await http.request({
        method: "GET",
        path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps`,
        query: {
          limit: "100",
          cursor,
        },
      }),
    );
    steps.push(...(page.steps as RunStepResource[]));
    if (page.nextCursor === undefined) {
      break;
    }
    cursor = page.nextCursor;
  }
  return steps;
}

export async function fetchToolVersion(
  http: OsvaHttpClient,
  toolId: string,
  toolVersionId: ToolVersionId,
): Promise<ToolVersionResource | undefined> {
  try {
    return toolVersionResourceSchema.parse(
      await http.request({
        method: "GET",
        path: `/v1/tools/${encodeURIComponent(toolId)}/versions/${encodeURIComponent(toolVersionId)}`,
      }),
    );
  } catch {
    return undefined;
  }
}

export function sortRunSteps(
  steps: readonly RunStepResource[],
): readonly RunStepResource[] {
  return [...steps].sort((left, right) => {
    if (left.startedAt !== right.startedAt) {
      return left.startedAt.localeCompare(right.startedAt);
    }
    return left.id.localeCompare(right.id);
  });
}

export function stepDurationMs(step: RunStepResource): number | undefined {
  if (step.completedAt === undefined) {
    return undefined;
  }
  const started = Date.parse(step.startedAt);
  const completed = Date.parse(step.completedAt);
  if (Number.isNaN(started) || Number.isNaN(completed)) {
    return undefined;
  }
  const delta = completed - started;
  return delta >= 0 ? delta : undefined;
}
