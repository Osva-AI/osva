import type { RunAttemptId, RunId, RunStepId } from "@osva-ai/contracts";
import {
  runAttemptUsageResourceSchema,
  runStepListResourceSchema,
  runStepResourceSchema,
} from "@osva-ai/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type RunAttemptUsageResource = z.infer<typeof runAttemptUsageResourceSchema>;
type RunStepListResource = z.infer<typeof runStepListResourceSchema>;
type RunStepResource = z.infer<typeof runStepResourceSchema>;

export interface ListRunStepsParams {
  readonly limit?: number;
  readonly cursor?: string;
}

export class RunObservabilityResource {
  constructor(private readonly client: OsvaHttpClient) {}

  listSteps(
    runId: RunId,
    runAttemptId: RunAttemptId,
    params: ListRunStepsParams = {},
  ): Promise<RunStepListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps`,
      query: {
        limit: params.limit === undefined ? undefined : String(params.limit),
        cursor: params.cursor,
      },
    });
  }

  getStep(
    runId: RunId,
    runAttemptId: RunAttemptId,
    runStepId: RunStepId,
  ): Promise<RunStepResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps/${encodeURIComponent(runStepId)}`,
    });
  }

  getUsage(
    runId: RunId,
    runAttemptId: RunAttemptId,
  ): Promise<RunAttemptUsageResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/usage`,
    });
  }
}
