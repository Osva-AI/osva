import type {
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowRunState,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  DomainInvariantError,
  LifecycleConflictError,
  WorkflowNodeRunNotFoundError,
  WorkflowRunNotFoundError,
  assertLegalWorkflowNodeRunTransition,
  assertLegalWorkflowRunTransition,
  isTerminalWorkflowRunState,
  type WorkflowNodeRun,
  type ListWorkflowRunsQuery,
  type ListWorkflowRunsResult,
  type WorkflowRun,
  type WorkflowRunListCursor,
  type WorkflowRunRepository,
} from "@osva/domain";

export class MemoryWorkflowRunRepository implements WorkflowRunRepository {
  private readonly workflowRuns = new Map<WorkflowRunId, WorkflowRun>();
  private readonly nodeRuns = new Map<WorkflowNodeRunId, WorkflowNodeRun>();

  async saveWorkflowRun(workflowRun: WorkflowRun): Promise<void> {
    if (this.workflowRuns.has(workflowRun.id)) {
      throw new DomainInvariantError(
        `A WorkflowRun with id '${workflowRun.id}' already exists.`,
      );
    }

    this.workflowRuns.set(workflowRun.id, workflowRun);
  }

  async findWorkflowRunById(id: WorkflowRunId): Promise<WorkflowRun | null> {
    return this.workflowRuns.get(id) ?? null;
  }

  async findWorkflowRunByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: WorkflowRunId,
  ): Promise<WorkflowRun | null> {
    const workflowRun = this.workflowRuns.get(id);
    if (workflowRun === undefined || workflowRun.workspaceId !== workspaceId) {
      return null;
    }

    return workflowRun;
  }

  async listActiveWorkflowRuns(limit: number): Promise<readonly WorkflowRun[]> {
    return [...this.workflowRuns.values()]
      .filter((run) => !isTerminalWorkflowRunState(run.status))
      .sort(compareWorkflowRuns)
      .slice(0, limit);
  }

  async listWorkflowRuns(
    query: ListWorkflowRunsQuery,
  ): Promise<ListWorkflowRunsResult> {
    const filtered = [...this.workflowRuns.values()].filter((run) => {
      if (run.workspaceId !== query.workspaceId) {
        return false;
      }

      if (
        query.workflowId !== undefined &&
        run.workflowId !== query.workflowId
      ) {
        return false;
      }

      if (
        query.workflowVersionId !== undefined &&
        run.workflowVersionId !== query.workflowVersionId
      ) {
        return false;
      }

      if (query.status !== undefined && run.status !== query.status) {
        return false;
      }

      if (
        query.cursor !== undefined &&
        !isBeforeWorkflowRunListCursor(run, query.cursor)
      ) {
        return false;
      }

      return true;
    });

    filtered.sort(compareWorkflowRunsCreatedAtIdDesc);

    const page = filtered.slice(0, query.limit);
    const hasMore = filtered.length > query.limit;
    const last = page[page.length - 1];

    return {
      workflowRuns: page,
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : undefined,
    };
  }

  async transitionWorkflowRun(
    expectedStatus: WorkflowRunState,
    next: WorkflowRun,
  ): Promise<WorkflowRun> {
    assertLegalWorkflowRunTransition(expectedStatus, next.status);

    const current = this.workflowRuns.get(next.id);
    if (current === undefined) {
      throw new WorkflowRunNotFoundError(next.id);
    }

    if (current.status !== expectedStatus) {
      throw new LifecycleConflictError("workflowRun", next.id, expectedStatus);
    }

    const updated = next;
    this.workflowRuns.set(next.id, updated);
    return updated;
  }

  async saveWorkflowNodeRun(nodeRun: WorkflowNodeRun): Promise<void> {
    const existing = this.nodeRuns.get(nodeRun.id);
    if (existing) {
      if (
        existing.childRunId !== undefined &&
        nodeRun.childRunId !== undefined &&
        existing.childRunId !== nodeRun.childRunId
      ) {
        throw new DomainInvariantError(
          `WorkflowNodeRun '${nodeRun.id}' already has child Run '${existing.childRunId}'.`,
        );
      }

      this.nodeRuns.set(nodeRun.id, nodeRun);
      return;
    }

    for (const stored of this.nodeRuns.values()) {
      if (
        stored.workflowRunId === nodeRun.workflowRunId &&
        stored.workflowNodeKey === nodeRun.workflowNodeKey
      ) {
        throw new DomainInvariantError(
          `WorkflowNodeRun already exists for workflow run '${nodeRun.workflowRunId}' node '${nodeRun.workflowNodeKey}'.`,
        );
      }

      if (
        stored.workflowRunId === nodeRun.workflowRunId &&
        stored.sequence === nodeRun.sequence
      ) {
        throw new DomainInvariantError(
          `WorkflowNodeRun sequence ${String(nodeRun.sequence)} already exists for workflow run '${nodeRun.workflowRunId}'.`,
        );
      }

      if (
        stored.childRunId !== undefined &&
        stored.childRunId === nodeRun.childRunId
      ) {
        throw new DomainInvariantError(
          `Child Run '${nodeRun.childRunId}' is already attached to a WorkflowNodeRun.`,
        );
      }
    }

    this.nodeRuns.set(nodeRun.id, nodeRun);
  }

  async findWorkflowNodeRunById(
    id: WorkflowNodeRunId,
  ): Promise<WorkflowNodeRun | null> {
    return this.nodeRuns.get(id) ?? null;
  }

  async findWorkflowNodeRunByWorkflowRunAndKey(
    workflowRunId: WorkflowRunId,
    workflowNodeKey: string,
  ): Promise<WorkflowNodeRun | null> {
    for (const stored of this.nodeRuns.values()) {
      if (
        stored.workflowRunId === workflowRunId &&
        stored.workflowNodeKey === workflowNodeKey
      ) {
        return stored;
      }
    }

    return null;
  }

  async listWorkflowNodeRuns(
    workflowRunId: WorkflowRunId,
  ): Promise<readonly WorkflowNodeRun[]> {
    return [...this.nodeRuns.values()]
      .filter((nodeRun) => nodeRun.workflowRunId === workflowRunId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async saveWorkflowNodeRunTransition(
    expectedStatus: WorkflowNodeRun["status"],
    next: WorkflowNodeRun,
  ): Promise<WorkflowNodeRun> {
    assertLegalWorkflowNodeRunTransition(expectedStatus, next.status);

    const current = this.nodeRuns.get(next.id);
    if (current === undefined) {
      throw new WorkflowNodeRunNotFoundError(next.id);
    }

    if (current.status !== expectedStatus) {
      throw new LifecycleConflictError(
        "workflowNodeRun",
        next.id,
        expectedStatus,
      );
    }

    const updated = next;
    this.nodeRuns.set(next.id, updated);
    return updated;
  }
}

function compareWorkflowRuns(left: WorkflowRun, right: WorkflowRun): number {
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

function compareWorkflowRunsCreatedAtIdDesc(
  left: WorkflowRun,
  right: WorkflowRun,
): number {
  const createdDelta = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdDelta !== 0) {
    return createdDelta;
  }

  if (right.id < left.id) {
    return -1;
  }

  if (right.id > left.id) {
    return 1;
  }

  return 0;
}

function isBeforeWorkflowRunListCursor(
  run: WorkflowRun,
  cursor: WorkflowRunListCursor,
): boolean {
  if (run.createdAt.getTime() < cursor.createdAt.getTime()) {
    return true;
  }

  return (
    run.createdAt.getTime() === cursor.createdAt.getTime() && run.id < cursor.id
  );
}
