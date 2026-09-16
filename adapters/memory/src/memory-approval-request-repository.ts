import type {
  ApprovalRequestId,
  ApprovalRequestState,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  ApprovalRequestNotFoundError,
  DomainInvariantError,
  LifecycleConflictError,
  assertLegalApprovalRequestTransition,
  type ApprovalRequest,
  type ApprovalRequestRepository,
} from "@osva/domain";

export class MemoryApprovalRequestRepository implements ApprovalRequestRepository {
  private readonly requests = new Map<ApprovalRequestId, ApprovalRequest>();

  async saveApprovalRequest(request: ApprovalRequest): Promise<void> {
    if (this.requests.has(request.id)) {
      throw new DomainInvariantError(
        `An ApprovalRequest with id '${request.id}' already exists.`,
      );
    }

    for (const stored of this.requests.values()) {
      if (stored.workflowNodeRunId === request.workflowNodeRunId) {
        throw new DomainInvariantError(
          `ApprovalRequest already exists for WorkflowNodeRun '${request.workflowNodeRunId}'.`,
        );
      }
    }

    this.requests.set(request.id, request);
  }

  async findApprovalRequestById(
    id: ApprovalRequestId,
  ): Promise<ApprovalRequest | null> {
    return this.requests.get(id) ?? null;
  }

  async findApprovalRequestByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ApprovalRequestId,
  ): Promise<ApprovalRequest | null> {
    const request = this.requests.get(id);
    if (request === undefined || request.workspaceId !== workspaceId) {
      return null;
    }

    return request;
  }

  async findApprovalRequestByWorkflowNodeRunId(
    workflowNodeRunId: WorkflowNodeRunId,
  ): Promise<ApprovalRequest | null> {
    for (const stored of this.requests.values()) {
      if (stored.workflowNodeRunId === workflowNodeRunId) {
        return stored;
      }
    }

    return null;
  }

  async listApprovalRequestsByWorkflowRunId(
    workflowRunId: WorkflowRunId,
  ): Promise<readonly ApprovalRequest[]> {
    return [...this.requests.values()]
      .filter((request) => request.workflowRunId === workflowRunId)
      .sort(compareApprovalRequests);
  }

  async saveApprovalRequestTransition(
    expectedStatus: ApprovalRequestState,
    next: ApprovalRequest,
  ): Promise<ApprovalRequest> {
    assertLegalApprovalRequestTransition(expectedStatus, next.status);

    const current = this.requests.get(next.id);
    if (current === undefined) {
      throw new ApprovalRequestNotFoundError(next.id);
    }

    if (current.status !== expectedStatus) {
      throw new LifecycleConflictError(
        "approvalRequest",
        next.id,
        expectedStatus,
      );
    }

    this.requests.set(next.id, next);
    return next;
  }
}

function compareApprovalRequests(
  left: ApprovalRequest,
  right: ApprovalRequest,
): number {
  const created = left.createdAt.getTime() - right.createdAt.getTime();
  if (created !== 0) {
    return created;
  }

  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}
