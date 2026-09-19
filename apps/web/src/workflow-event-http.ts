import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkflowEventId } from "@osva/contracts";
import { WORKFLOW_EVENT_HTTP_REQUEST_MAX_BYTES } from "@osva/contracts";
import { ingestWorkflowEventRequestSchema } from "@osva/contracts/schemas";
import type { WorkflowEvent } from "@osva/domain";
import type { IngestWorkflowEvent } from "@osva/orchestration";

import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";
import { logEvent } from "./log.js";

export interface WorkflowEventHttpServices {
  readonly ingest: IngestWorkflowEvent;
  readonly clock: { readonly now: () => Date };
  readonly ids: { readonly createWorkflowEventId: () => WorkflowEventId };
}

export async function handleWorkflowEventRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  services: WorkflowEventHttpServices | undefined,
): Promise<boolean> {
  if (path !== "/v1/workflow-events") {
    return false;
  }

  if (services === undefined) {
    sendJson(response, 404, { status: "not_found" });
    return true;
  }

  try {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "POST" },
      );
      return true;
    }

    const parsed = ingestWorkflowEventRequestSchema.safeParse(
      await readJsonBody(request, {
        maxBytes: WORKFLOW_EVENT_HTTP_REQUEST_MAX_BYTES,
      }),
    );
    if (!parsed.success) {
      sendJson(response, 400, { status: "invalid_request" });
      return true;
    }

    const body = parsed.data;
    const persisted = await services.ingest.execute({
      submission: {
        workspaceId: body.workspaceId,
        source: body.source,
        eventType: body.eventType,
        correlationKey: body.correlationKey,
        idempotencyKey: body.idempotencyKey,
        payload: body.payload,
        occurredAt:
          body.occurredAt === undefined ? undefined : new Date(body.occurredAt),
      },
      eventId: services.ids.createWorkflowEventId(),
      now: services.clock.now(),
    });

    logEvent("workflow_event.ingested", {
      workflowEventId: persisted.id,
      workspaceId: persisted.workspaceId,
      source: persisted.source,
      eventType: persisted.eventType,
    });

    sendJson(response, 200, toWorkflowEventResource(persisted));
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

function toWorkflowEventResource(event: WorkflowEvent): object {
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    source: event.source,
    eventType: event.eventType,
    correlationKey: event.correlationKey,
    idempotencyKey: event.idempotencyKey,
    payload: event.payload,
    ...(event.occurredAt === undefined
      ? {}
      : { occurredAt: event.occurredAt.toISOString() }),
    receivedAt: event.receivedAt.toISOString(),
  };
}
