import type {
  ApprovalRequestId,
  ApprovalRequestState,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  ApprovalRequestNotFoundError,
  LifecycleConflictError,
  assertLegalApprovalRequestTransition,
  type ApprovalRequest,
  type ApprovalRequestRepository,
} from "@osva/domain";
import { and, asc, eq } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  approvalRequestFromRow,
  approvalRequestToRow,
} from "../mappers/approval-request-mapper.js";
import { withMappedDatabaseErrors } from "../postgres-errors.js";
import { approvalRequests } from "../schema/approval-requests.js";

export class PostgresApprovalRequestRepository implements ApprovalRequestRepository {
  constructor(private readonly database: Database) {}

  async saveApprovalRequest(request: ApprovalRequest): Promise<void> {
    await withMappedDatabaseErrors(
      () =>
        this.database.db
          .insert(approvalRequests)
          .values(approvalRequestToRow(request)),
      {
        approval_requests_pkey: `An ApprovalRequest with id '${request.id}' already exists.`,
        approval_requests_workflow_node_run_id_unique: `ApprovalRequest already exists for WorkflowNodeRun '${request.workflowNodeRunId}'.`,
        approval_requests_workspace_id_id_unique: `An ApprovalRequest with id '${request.id}' already exists.`,
      },
    );
  }

  async findApprovalRequestById(
    id: ApprovalRequestId,
  ): Promise<ApprovalRequest | null> {
    const [row] = await this.database.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);

    return row === undefined ? null : approvalRequestFromRow(row);
  }

  async findApprovalRequestByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ApprovalRequestId,
  ): Promise<ApprovalRequest | null> {
    const [row] = await this.database.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.workspaceId, workspaceId),
          eq(approvalRequests.id, id),
        ),
      )
      .limit(1);

    return row === undefined ? null : approvalRequestFromRow(row);
  }

  async findApprovalRequestByWorkflowNodeRunId(
    workflowNodeRunId: WorkflowNodeRunId,
  ): Promise<ApprovalRequest | null> {
    const [row] = await this.database.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.workflowNodeRunId, workflowNodeRunId))
      .limit(1);

    return row === undefined ? null : approvalRequestFromRow(row);
  }

  async listApprovalRequestsByWorkflowRunId(
    workflowRunId: WorkflowRunId,
  ): Promise<readonly ApprovalRequest[]> {
    const rows = await this.database.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.workflowRunId, workflowRunId))
      .orderBy(asc(approvalRequests.createdAt), asc(approvalRequests.id));

    return rows.map(approvalRequestFromRow);
  }

  async saveApprovalRequestTransition(
    expectedStatus: ApprovalRequestState,
    next: ApprovalRequest,
  ): Promise<ApprovalRequest> {
    assertLegalApprovalRequestTransition(expectedStatus, next.status);
    const rowValues = approvalRequestToRow(next);

    const [row] = await this.database.db
      .update(approvalRequests)
      .set({
        status: rowValues.status,
        decisionComment: rowValues.decisionComment,
        decidedAt: rowValues.decidedAt,
        updatedAt: rowValues.updatedAt,
      })
      .where(
        and(
          eq(approvalRequests.id, next.id),
          eq(approvalRequests.status, expectedStatus),
        ),
      )
      .returning();

    if (row !== undefined) {
      return approvalRequestFromRow(row);
    }

    const existing = await this.findApprovalRequestById(next.id);
    if (existing === null) {
      throw new ApprovalRequestNotFoundError(next.id);
    }

    throw new LifecycleConflictError(
      "approvalRequest",
      next.id,
      expectedStatus,
    );
  }
}
