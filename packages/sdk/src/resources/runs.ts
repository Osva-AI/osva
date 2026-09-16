import type { RunAttemptId, RunId } from "@osva/contracts";
import {
  createRunRequestSchema,
  createRunResponseSchema,
  runAttemptListResourceSchema,
  runAttemptResourceSchema,
  runListResourceSchema,
  runResourceSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
type CreateRunResponse = z.infer<typeof createRunResponseSchema>;
type RunAttemptListResource = z.infer<typeof runAttemptListResourceSchema>;
type RunAttemptResource = z.infer<typeof runAttemptResourceSchema>;
type RunListResource = z.infer<typeof runListResourceSchema>;
type RunResource = z.infer<typeof runResourceSchema>;

export interface ListRunsParams {
  readonly agentId?: string;
  readonly agentVersionId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export class RunsResource {
  constructor(
    private readonly client: OsvaHttpClient,
    private readonly workspaceId: string,
  ) {}

  list(params: ListRunsParams = {}): Promise<RunListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/runs",
      query: {
        agentId: params.agentId,
        agentVersionId: params.agentVersionId,
        status: params.status,
        limit: params.limit === undefined ? undefined : String(params.limit),
        cursor: params.cursor,
      },
    });
  }

  get(runId: RunId): Promise<RunResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/runs/${encodeURIComponent(runId)}`,
    });
  }

  create(
    input: Omit<CreateRunRequest, "workspaceId">,
  ): Promise<CreateRunResponse> {
    return this.client.request({
      method: "POST",
      path: "/v1/runs",
      body: {
        ...input,
        workspaceId: this.workspaceId,
      },
    });
  }

  listAttempts(runId: RunId): Promise<RunAttemptListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/runs/${encodeURIComponent(runId)}/attempts`,
    });
  }

  getAttempt(
    runId: RunId,
    runAttemptId: RunAttemptId,
  ): Promise<RunAttemptResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}`,
    });
  }
}
