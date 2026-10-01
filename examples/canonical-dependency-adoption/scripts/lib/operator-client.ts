import type {
  WorkflowEventId,
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  ingestWorkflowEventRequestSchema,
  workflowEventResourceSchema,
} from "@osva-ai/contracts/schemas";
import { OsvaApiError, OsvaClient, OsvaHttpClient } from "@osva-ai/sdk";

import type { OperatorEnv } from "./operator-env.js";
import { CANONICAL_SETUP_STALE_MESSAGE } from "./operator-env.js";
import { readCanonicalState, type CanonicalStateV1 } from "./state.js";

export interface IngestWorkflowEventRequest {
  readonly source: string;
  readonly eventType: string;
  readonly correlationKey: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly occurredAt?: string;
}

export interface WorkflowEventResource {
  readonly id: WorkflowEventId;
  readonly workspaceId: WorkspaceId;
  readonly source: string;
  readonly eventType: string;
  readonly correlationKey: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly occurredAt?: string;
  readonly receivedAt: string;
}

export class OperatorApi {
  readonly sdk: OsvaClient;
  readonly http: OsvaHttpClient;

  constructor(env: OperatorEnv) {
    this.http = new OsvaHttpClient({
      baseUrl: env.baseUrl,
      apiKey: env.apiKey,
      timeoutMs: env.requestTimeoutMs,
    });
    this.sdk = new OsvaClient({
      baseUrl: env.baseUrl,
      apiKey: env.apiKey,
      timeoutMs: env.requestTimeoutMs,
    });
  }

  async ingestWorkflowEvent(
    body: IngestWorkflowEventRequest,
  ): Promise<WorkflowEventResource> {
    ingestWorkflowEventRequestSchema.parse(body);
    return workflowEventResourceSchema.parse(
      await this.http.request({
        method: "POST",
        path: "/v1/workflow-events",
        body,
      }),
    );
  }

  async loadVerifiedCanonicalState(
    workspaceId: string,
  ): Promise<CanonicalStateV1> {
    const state = await readCanonicalState();
    if (state === null) {
      throw new OperatorSetupError(CANONICAL_SETUP_STALE_MESSAGE);
    }
    if (state.workspaceId !== workspaceId) {
      throw new OperatorSetupError(CANONICAL_SETUP_STALE_MESSAGE);
    }
    if (state.workflowId.length === 0 || state.workflowVersionId.length === 0) {
      throw new OperatorSetupError(CANONICAL_SETUP_STALE_MESSAGE);
    }

    try {
      await this.sdk.workflows.getVersion(
        state.workflowId as WorkflowId,
        state.workflowVersionId as WorkflowVersionId,
      );
    } catch (error) {
      if (error instanceof OsvaApiError && error.status === 404) {
        throw new OperatorSetupError(CANONICAL_SETUP_STALE_MESSAGE);
      }
      throw error;
    }

    return state;
  }
}

export class OperatorSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorSetupError";
  }
}
