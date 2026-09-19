import type { WorkflowEventId, WorkspaceId } from "@osva/contracts";

import type { WorkflowEvent } from "../workflow-event.js";
import type { WorkflowWait } from "../workflow-wait.js";

export interface WorkflowEventRepository {
  saveWorkflowEvent(event: WorkflowEvent): Promise<WorkflowEvent>;

  findWorkflowEventById(id: WorkflowEventId): Promise<WorkflowEvent | null>;

  findWorkflowEventByIngestionIdentity(
    workspaceId: WorkspaceId,
    source: string,
    idempotencyKey: string,
  ): Promise<WorkflowEvent | null>;

  listWorkflowEventCandidatesForWait(
    wait: WorkflowWait,
    now: Date,
  ): Promise<readonly WorkflowEvent[]>;
}
