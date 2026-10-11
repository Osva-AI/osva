import type { WorkflowRunId } from "@osva-ai/contracts";
import {
  createWorkflowRunRequestSchema,
  workflowRunListResourceSchema,
  workflowRunResourceSchema,
} from "@osva-ai/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateWorkflowRunRequest = z.infer<typeof createWorkflowRunRequestSchema>;
type WorkflowRunListResource = z.infer<typeof workflowRunListResourceSchema>;
type WorkflowRunResource = z.infer<typeof workflowRunResourceSchema>;

export interface ListWorkflowRunsParams {
  readonly workflowId?: string;
  readonly workflowVersionId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export class WorkflowRunsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(params: ListWorkflowRunsParams = {}): Promise<WorkflowRunListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/workflow-runs",
      query: {
        workflowId: params.workflowId,
        workflowVersionId: params.workflowVersionId,
        status: params.status,
        limit: params.limit === undefined ? undefined : String(params.limit),
        cursor: params.cursor,
      },
    });
  }

  create(input: CreateWorkflowRunRequest): Promise<WorkflowRunResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/workflow-runs",
      body: input,
    });
  }

  get(workflowRunId: WorkflowRunId): Promise<WorkflowRunResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/workflow-runs/${encodeURIComponent(workflowRunId)}`,
    });
  }
}
