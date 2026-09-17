import type { WorkflowId, WorkflowVersionId } from "@osva/contracts";
import {
  createWorkflowRequestSchema,
  createWorkflowVersionRequestSchema,
  workflowListResourceSchema,
  workflowResourceSchema,
  workflowVersionListResourceSchema,
  workflowVersionResourceSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateWorkflowRequest = z.infer<typeof createWorkflowRequestSchema>;
type CreateWorkflowVersionRequest = z.infer<
  typeof createWorkflowVersionRequestSchema
>;
type WorkflowListResource = z.infer<typeof workflowListResourceSchema>;
type WorkflowResource = z.infer<typeof workflowResourceSchema>;
type WorkflowVersionListResource = z.infer<
  typeof workflowVersionListResourceSchema
>;
type WorkflowVersionResource = z.infer<typeof workflowVersionResourceSchema>;

export class WorkflowsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<WorkflowListResource> {
    return this.client.request({ method: "GET", path: "/v1/workflows" });
  }

  get(workflowId: WorkflowId): Promise<WorkflowResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/workflows/${encodeURIComponent(workflowId)}`,
    });
  }

  create(input: CreateWorkflowRequest): Promise<WorkflowResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/workflows",
      body: input,
    });
  }

  listVersions(workflowId: WorkflowId): Promise<WorkflowVersionListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
    });
  }

  getVersion(
    workflowId: WorkflowId,
    workflowVersionId: WorkflowVersionId,
  ): Promise<WorkflowVersionResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(workflowVersionId)}`,
    });
  }

  createVersion(
    workflowId: WorkflowId,
    input: CreateWorkflowVersionRequest,
  ): Promise<WorkflowVersionResource> {
    return this.client.request({
      method: "POST",
      path: `/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
      body: input,
    });
  }
}
