import type { ApprovalRequestId } from "@osva/contracts";
import {
  approvalRequestResourceSchema,
  decideApprovalRequestSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type ApprovalRequestResource = z.infer<typeof approvalRequestResourceSchema>;
type DecideApprovalRequest = z.infer<typeof decideApprovalRequestSchema>;

export class ApprovalsResource {
  constructor(
    private readonly client: OsvaHttpClient,
    private readonly workspaceId: string,
  ) {}

  get(approvalRequestId: ApprovalRequestId): Promise<ApprovalRequestResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/approval-requests/${encodeURIComponent(approvalRequestId)}`,
      query: { workspaceId: this.workspaceId },
    });
  }

  decide(
    approvalRequestId: ApprovalRequestId,
    input: Omit<DecideApprovalRequest, "workspaceId">,
  ): Promise<ApprovalRequestResource> {
    return this.client.request({
      method: "POST",
      path: `/v1/approval-requests/${encodeURIComponent(approvalRequestId)}/decision`,
      body: {
        ...input,
        workspaceId: this.workspaceId,
      },
    });
  }
}
