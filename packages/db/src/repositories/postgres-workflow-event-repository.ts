import type { WorkflowEventId, WorkspaceId } from "@osva/contracts";
import {
  DomainInvariantError,
  assertWorkflowEventEquivalentRetry,
  hasWorkflowEventIngestionIdentity,
  isEquivalentWorkflowEventRetry,
  type WorkflowEvent,
  type WorkflowEventRepository,
  type WorkflowEventSubmission,
  type WorkflowWait,
} from "@osva/domain";
import { and, eq } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  workflowEventFromRow,
  workflowEventToRow,
} from "../mappers/workflow-event-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { workflowEvents } from "../schema/workflow-events.js";
import { selectWorkflowEventCandidatesForWait } from "./postgres-workflow-event-candidates.js";

const INGESTION_IDENTITY_UNIQUE =
  "workflow_events_workspace_id_source_idempotency_key_unique";
const WORKSPACE_EVENT_ID_UNIQUE = "workflow_events_workspace_id_id_unique";

export class PostgresWorkflowEventRepository implements WorkflowEventRepository {
  constructor(private readonly database: Database) {}

  async saveWorkflowEvent(event: WorkflowEvent): Promise<WorkflowEvent> {
    const submission = toSubmission(event);
    const existingByIngestion = await this.findWorkflowEventByIngestionIdentity(
      event.workspaceId,
      event.source,
      event.idempotencyKey,
    );

    if (existingByIngestion !== null) {
      assertWorkflowEventEquivalentRetry(existingByIngestion, submission);
      return existingByIngestion;
    }

    const existingById = await this.findWorkflowEventById(event.id);
    if (existingById !== null) {
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

    try {
      await this.database.db
        .insert(workflowEvents)
        .values(workflowEventToRow(event));
      return event;
    } catch (error) {
      return this.recoverSaveWorkflowEventFromUniqueViolation(
        error,
        event,
        submission,
      );
    }
  }

  async findWorkflowEventById(
    id: WorkflowEventId,
  ): Promise<WorkflowEvent | null> {
    const [row] = await this.database.db
      .select()
      .from(workflowEvents)
      .where(eq(workflowEvents.id, id))
      .limit(1);

    return row === undefined ? null : workflowEventFromRow(row);
  }

  async listWorkflowEventCandidatesForWait(
    wait: WorkflowWait,
    now: Date,
  ): Promise<readonly WorkflowEvent[]> {
    return selectWorkflowEventCandidatesForWait(this.database.db, wait, now);
  }

  async findWorkflowEventByIngestionIdentity(
    workspaceId: WorkspaceId,
    source: string,
    idempotencyKey: string,
  ): Promise<WorkflowEvent | null> {
    const [row] = await this.database.db
      .select()
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.workspaceId, workspaceId),
          eq(workflowEvents.source, source),
          eq(workflowEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return row === undefined ? null : workflowEventFromRow(row);
  }

  private async recoverSaveWorkflowEventFromUniqueViolation(
    error: unknown,
    event: WorkflowEvent,
    submission: WorkflowEventSubmission,
  ): Promise<WorkflowEvent> {
    if (postgresErrorCode(error) !== POSTGRES_UNIQUE_VIOLATION) {
      throw mapDatabaseError(error);
    }

    const constraint = postgresConstraintName(error);
    if (constraint === INGESTION_IDENTITY_UNIQUE) {
      const existing = await this.findWorkflowEventByIngestionIdentity(
        event.workspaceId,
        event.source,
        event.idempotencyKey,
      );
      if (existing === null) {
        throw error;
      }

      assertWorkflowEventEquivalentRetry(existing, submission);
      return existing;
    }

    if (constraint === WORKSPACE_EVENT_ID_UNIQUE) {
      const existing = await this.findWorkflowEventById(event.id);
      if (existing === null) {
        throw error;
      }

      if (
        hasWorkflowEventIngestionIdentity(existing, event) &&
        isEquivalentWorkflowEventRetry(existing, submission)
      ) {
        return existing;
      }

      throw new DomainInvariantError(
        `WorkflowEvent id '${event.id}' is already persisted with a different ingestion identity.`,
      );
    }

    throw mapDatabaseError(error);
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
