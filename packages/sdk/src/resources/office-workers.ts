import type { OfficeWorkerId, WorkspaceId } from "@osva/contracts";
import {
  createOfficeWorkerRequestSchema,
  officeWorkerListResourceSchema,
  officeWorkerResourceSchema,
  updateOfficeWorkerRequestSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type OfficeWorkerResource = z.infer<typeof officeWorkerResourceSchema>;
type OfficeWorkerListResource = z.infer<typeof officeWorkerListResourceSchema>;
type CreateOfficeWorkerRequest = z.infer<
  typeof createOfficeWorkerRequestSchema
>;
type UpdateOfficeWorkerRequest = z.infer<
  typeof updateOfficeWorkerRequestSchema
>;

export class OfficeWorkersResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(workspaceId: WorkspaceId): Promise<OfficeWorkerListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/office-workers",
      query: { workspaceId },
    });
  }

  get(officeWorkerId: OfficeWorkerId): Promise<OfficeWorkerResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/office-workers/${encodeURIComponent(officeWorkerId)}`,
    });
  }

  create(input: CreateOfficeWorkerRequest): Promise<OfficeWorkerResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/office-workers",
      body: input,
    });
  }

  update(
    officeWorkerId: OfficeWorkerId,
    input: UpdateOfficeWorkerRequest,
  ): Promise<OfficeWorkerResource> {
    return this.client.request({
      method: "PATCH",
      path: `/v1/office-workers/${encodeURIComponent(officeWorkerId)}`,
      body: input,
    });
  }
}
