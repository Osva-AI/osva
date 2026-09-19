import type { WorkflowNodeRunId, WorkflowRunId } from "@osva/contracts";
import {
  DomainInvariantError,
  WorkflowWaitNotFoundError,
  WorkflowWaitResolutionConflictError,
  hasSameDurableWorkflowWaitResolution,
  isTerminalWorkflowRunState,
  type WorkflowEventRepository,
  type WorkflowEventWaitMatchQuery,
  type WorkflowRunRepository,
  type WorkflowWait,
  type WorkflowWaitRepository,
} from "@osva/domain";

type WorkflowEventCandidateLookup = Pick<
  WorkflowEventRepository,
  "listWorkflowEventCandidatesForWait"
>;

type WorkflowRunStatusLookup = Pick<
  WorkflowRunRepository,
  "findWorkflowRunById"
>;

export class MemoryWorkflowWaitRepository implements WorkflowWaitRepository {
  private readonly waits = new Map<WorkflowNodeRunId, WorkflowWait>();

  constructor(
    private readonly workflowEvents?: WorkflowEventCandidateLookup,
    private readonly workflowRuns?: WorkflowRunStatusLookup,
  ) {}

  async saveWorkflowWait(wait: WorkflowWait): Promise<void> {
    if (this.waits.has(wait.workflowNodeRunId)) {
      throw new DomainInvariantError(
        `WorkflowWait already exists for WorkflowNodeRun '${wait.workflowNodeRunId}'.`,
      );
    }

    this.waits.set(wait.workflowNodeRunId, wait);
  }

  async findWorkflowWaitByWorkflowNodeRunId(
    workflowNodeRunId: WorkflowNodeRunId,
  ): Promise<WorkflowWait | null> {
    return this.waits.get(workflowNodeRunId) ?? null;
  }

  async listWorkflowWaitsByWorkflowRunId(
    workflowRunId: WorkflowRunId,
  ): Promise<readonly WorkflowWait[]> {
    return [...this.waits.values()]
      .filter((wait) => wait.workflowRunId === workflowRunId)
      .sort(compareWorkflowWaits);
  }

  async listDueTimerWorkflowWaits(
    now: Date,
    limit: number,
  ): Promise<readonly WorkflowWait[]> {
    const due: WorkflowWait[] = [];
    for (const wait of this.waits.values()) {
      if (
        wait.kind === "TIMER" &&
        wait.resolution === undefined &&
        wait.wakeAt !== undefined &&
        wait.wakeAt.getTime() <= now.getTime() &&
        (await this.isActiveWorkflowRunForWaitDiscovery(wait.workflowRunId))
      ) {
        due.push(wait);
      }
    }

    return due.sort(compareDueTimerWorkflowWaits).slice(0, limit);
  }

  async listActiveEventWorkflowWaitsByMatch(
    query: WorkflowEventWaitMatchQuery,
  ): Promise<readonly WorkflowWait[]> {
    const matched: WorkflowWait[] = [];
    for (const wait of this.waits.values()) {
      if (
        wait.kind === "EVENT" &&
        wait.resolution === undefined &&
        wait.workspaceId === query.workspaceId &&
        wait.eventSource === query.source &&
        wait.eventType === query.eventType &&
        wait.correlationKey === query.correlationKey &&
        (await this.isActiveWorkflowRunForWaitDiscovery(wait.workflowRunId))
      ) {
        matched.push(wait);
      }
    }

    return matched.sort((left, right) =>
      left.workflowNodeRunId < right.workflowNodeRunId
        ? -1
        : left.workflowNodeRunId > right.workflowNodeRunId
          ? 1
          : 0,
    );
  }

  async listResolvableEventWorkflowWaits(
    now: Date,
    limit: number,
  ): Promise<readonly WorkflowWait[]> {
    const resolvable: WorkflowWait[] = [];
    for (const wait of this.waits.values()) {
      if (
        (await this.isActiveWorkflowRunForWaitDiscovery(wait.workflowRunId)) &&
        (await this.isResolvableEventWorkflowWait(wait, now))
      ) {
        resolvable.push(wait);
      }
    }

    return resolvable.sort(compareWorkflowWaits).slice(0, limit);
  }

  async saveWorkflowWaitResolution(next: WorkflowWait): Promise<WorkflowWait> {
    if (next.resolution === undefined) {
      throw new DomainInvariantError(
        "saveWorkflowWaitResolution requires a resolved WorkflowWait.",
      );
    }

    const existing = this.waits.get(next.workflowNodeRunId);
    if (existing === undefined) {
      throw new WorkflowWaitNotFoundError(next.workflowNodeRunId);
    }

    assertWorkflowWaitResolutionIdentity(existing, next);

    if (existing.resolution === undefined) {
      this.waits.set(next.workflowNodeRunId, next);
      return next;
    }

    if (hasSameDurableWorkflowWaitResolution(existing, next)) {
      return existing;
    }

    throw new WorkflowWaitResolutionConflictError(
      existing.resolution,
      next.resolution,
    );
  }

  private async isActiveWorkflowRunForWaitDiscovery(
    workflowRunId: WorkflowRunId,
  ): Promise<boolean> {
    if (this.workflowRuns === undefined) {
      return true;
    }

    const run = await this.workflowRuns.findWorkflowRunById(workflowRunId);
    if (run === null) {
      return true;
    }

    return !isTerminalWorkflowRunState(run.status);
  }

  private async isResolvableEventWorkflowWait(
    wait: WorkflowWait,
    now: Date,
  ): Promise<boolean> {
    if (wait.kind !== "EVENT" || wait.resolution !== undefined) {
      return false;
    }

    if (
      wait.expiresAt !== undefined &&
      wait.expiresAt.getTime() <= now.getTime()
    ) {
      return true;
    }

    if (this.workflowEvents === undefined) {
      return false;
    }

    const candidates =
      await this.workflowEvents.listWorkflowEventCandidatesForWait(wait, now);
    return candidates.length > 0;
  }
}

function assertWorkflowWaitResolutionIdentity(
  existing: WorkflowWait,
  next: WorkflowWait,
): void {
  if (
    existing.workspaceId !== next.workspaceId ||
    existing.workflowRunId !== next.workflowRunId
  ) {
    throw new DomainInvariantError(
      `WorkflowWait identity mismatch for WorkflowNodeRun '${next.workflowNodeRunId}'.`,
    );
  }
}

function compareDueTimerWorkflowWaits(
  left: WorkflowWait,
  right: WorkflowWait,
): number {
  const wake = left.wakeAt!.getTime() - right.wakeAt!.getTime();
  if (wake !== 0) {
    return wake;
  }

  if (left.workflowNodeRunId < right.workflowNodeRunId) {
    return -1;
  }

  if (left.workflowNodeRunId > right.workflowNodeRunId) {
    return 1;
  }

  return 0;
}

function compareWorkflowWaits(left: WorkflowWait, right: WorkflowWait): number {
  const armed = left.armedAt.getTime() - right.armedAt.getTime();
  if (armed !== 0) {
    return armed;
  }

  if (left.workflowNodeRunId < right.workflowNodeRunId) {
    return -1;
  }

  if (left.workflowNodeRunId > right.workflowNodeRunId) {
    return 1;
  }

  return 0;
}
