import type { WorkflowRunId } from "@osva/contracts";
import {
  createWorkflowRunRequestSchema,
  workflowRunResourceSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateWorkflowRunRequest = z.infer<typeof createWorkflowRunRequestSchema>;
type WorkflowRunResource = z.infer<typeof workflowRunResourceSchema>;

export class WorkflowRunsResource {
  constructor(
    private readonly client: OsvaHttpClient,
    private readonly workspaceId: string,
  ) {}

  create(
    input: Omit<CreateWorkflowRunRequest, "workspaceId">,
  ): Promise<WorkflowRunResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/workflow-runs",
      body: {
        ...input,
        workspaceId: this.workspaceId,
      },
    });
  }

  get(workflowRunId: WorkflowRunId): Promise<WorkflowRunResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/workflow-runs/${encodeURIComponent(workflowRunId)}`,
    });
  }
}
