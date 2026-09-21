import type { AssignmentId } from "@osva/contracts";
import {
  assignmentListResourceSchema,
  assignmentResourceSchema,
  createAssignmentRequestSchema,
  updateAssignmentRequestSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type AssignmentResource = z.infer<typeof assignmentResourceSchema>;
type AssignmentListResource = z.infer<typeof assignmentListResourceSchema>;
type CreateAssignmentRequest = z.infer<typeof createAssignmentRequestSchema>;
type UpdateAssignmentRequest = z.infer<typeof updateAssignmentRequestSchema>;

export class AssignmentsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<AssignmentListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/assignments",
    });
  }

  get(assignmentId: AssignmentId): Promise<AssignmentResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/assignments/${encodeURIComponent(assignmentId)}`,
    });
  }

  create(input: CreateAssignmentRequest): Promise<AssignmentResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/assignments",
      body: input,
    });
  }

  update(
    assignmentId: AssignmentId,
    input: UpdateAssignmentRequest,
  ): Promise<AssignmentResource> {
    return this.client.request({
      method: "PATCH",
      path: `/v1/assignments/${encodeURIComponent(assignmentId)}`,
      body: input,
    });
  }

  launch(assignmentId: AssignmentId): Promise<AssignmentResource> {
    return this.client.request({
      method: "POST",
      path: `/v1/assignments/${encodeURIComponent(assignmentId)}/launch`,
    });
  }

  cancel(assignmentId: AssignmentId): Promise<AssignmentResource> {
    return this.client.request({
      method: "POST",
      path: `/v1/assignments/${encodeURIComponent(assignmentId)}/cancel`,
    });
  }
}
