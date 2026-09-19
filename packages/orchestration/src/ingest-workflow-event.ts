import type { WorkflowEventId } from "@osva/contracts";
import {
  WorkflowEvent,
  type WorkflowEventRepository,
  type WorkflowEventSubmission,
  type WorkflowEventWaitResolutionRepository,
  type WorkflowWaitRepository,
} from "@osva/domain";

export interface IngestWorkflowEventCommand {
  readonly submission: WorkflowEventSubmission;
  readonly eventId: WorkflowEventId;
  readonly now: Date;
}

export interface IngestWorkflowEventDependencies {
  readonly workflowEvents: WorkflowEventRepository;
  readonly workflowWaits: WorkflowWaitRepository;
  readonly eventWaitResolution: WorkflowEventWaitResolutionRepository;
}

export class IngestWorkflowEvent {
  constructor(private readonly deps: IngestWorkflowEventDependencies) {}

  async execute(command: IngestWorkflowEventCommand): Promise<WorkflowEvent> {
    const created = WorkflowEvent.create({
      id: command.eventId,
      workspaceId: command.submission.workspaceId,
      source: command.submission.source,
      eventType: command.submission.eventType,
      correlationKey: command.submission.correlationKey,
      idempotencyKey: command.submission.idempotencyKey,
      payload: command.submission.payload,
      occurredAt: command.submission.occurredAt,
      receivedAt: command.now,
    });

    const persisted = await this.deps.workflowEvents.saveWorkflowEvent(created);
    const matching =
      await this.deps.workflowWaits.listActiveEventWorkflowWaitsByMatch({
        workspaceId: persisted.workspaceId,
        source: persisted.source,
        eventType: persisted.eventType,
        correlationKey: persisted.correlationKey,
      });

    for (const wait of matching) {
      await this.deps.eventWaitResolution.resolveWorkflowEventWait(
        wait.workflowNodeRunId,
        command.now,
      );
    }

    return persisted;
  }
}
