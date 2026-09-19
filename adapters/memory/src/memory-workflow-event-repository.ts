import type { WorkflowEventId, WorkspaceId } from "@osva/contracts";
import {
  DomainInvariantError,
  assertWorkflowEventEquivalentRetry,
  hasWorkflowEventIngestionIdentity,
  isEquivalentWorkflowEventRetry,
  type WorkflowEvent,
  listWorkflowEventCandidatesForWait as orderWorkflowEventCandidatesForWait,
  type WorkflowEventRepository,
  type WorkflowEventSubmission,
  type WorkflowWait,
} from "@osva/domain";

export class MemoryWorkflowEventRepository implements WorkflowEventRepository {
  private readonly eventsById = new Map<WorkflowEventId, WorkflowEvent>();
  private readonly eventsByIngestion = new Map<
    WorkspaceId,
    Map<string, Map<string, WorkflowEvent>>
  >();

  async saveWorkflowEvent(event: WorkflowEvent): Promise<WorkflowEvent> {
    const submission = toSubmission(event);
    const existingByIngestion = this.findPersistedByIngestion(
      event.workspaceId,
      event.source,
      event.idempotencyKey,
    );

    if (existingByIngestion !== undefined) {
      assertWorkflowEventEquivalentRetry(existingByIngestion, submission);
      return existingByIngestion;
    }

    const existingById = this.eventsById.get(event.id);
    if (existingById !== undefined) {
      if (
        hasWorkflowEventIngestionIdentity(existingById, event) &&
        isEquivalentWorkflowEventRetry(existingById, submission)
      ) {
        return existingById;
      }

      throw new DomainInvariantError(
        `WorkflowEvent id '${event.id}' is already persisted with a different ingestion identity.`,
      );
    }

    this.eventsById.set(event.id, event);
    this.indexIngestion(event);
    return event;
  }

  async findWorkflowEventById(
    id: WorkflowEventId,
  ): Promise<WorkflowEvent | null> {
    return this.eventsById.get(id) ?? null;
  }

  async listWorkflowEventCandidatesForWait(
    wait: WorkflowWait,
    now: Date,
  ): Promise<readonly WorkflowEvent[]> {
    return orderWorkflowEventCandidatesForWait(
      wait,
      [...this.eventsById.values()],
      now,
    );
  }

  async findWorkflowEventByIngestionIdentity(
    workspaceId: WorkspaceId,
    source: string,
    idempotencyKey: string,
  ): Promise<WorkflowEvent | null> {
    return (
      this.findPersistedByIngestion(workspaceId, source, idempotencyKey) ?? null
    );
  }

  private findPersistedByIngestion(
    workspaceId: WorkspaceId,
    source: string,
    idempotencyKey: string,
  ): WorkflowEvent | undefined {
    const bySource = this.eventsByIngestion.get(workspaceId)?.get(source);
    return bySource?.get(idempotencyKey);
  }

  private indexIngestion(event: WorkflowEvent): void {
    let byWorkspace = this.eventsByIngestion.get(event.workspaceId);
    if (byWorkspace === undefined) {
      byWorkspace = new Map();
      this.eventsByIngestion.set(event.workspaceId, byWorkspace);
    }

    let bySource = byWorkspace.get(event.source);
    if (bySource === undefined) {
      bySource = new Map();
      byWorkspace.set(event.source, bySource);
    }

    bySource.set(event.idempotencyKey, event);
  }
}

function toSubmission(event: WorkflowEvent): WorkflowEventSubmission {
  return {
    workspaceId: event.workspaceId,
    source: event.source,
    eventType: event.eventType,
    correlationKey: event.correlationKey,
    idempotencyKey: event.idempotencyKey,
    payload: event.payload,
    occurredAt: event.occurredAt,
  };
}
