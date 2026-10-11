import {
  ingestWorkflowEventRequestSchema,
  workflowEventResourceSchema,
} from "@osva-ai/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type IngestWorkflowEventRequest = z.infer<
  typeof ingestWorkflowEventRequestSchema
>;
type WorkflowEventResource = z.infer<typeof workflowEventResourceSchema>;

export class WorkflowEventsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  ingest(input: IngestWorkflowEventRequest): Promise<WorkflowEventResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/workflow-events",
      body: input,
    });
  }
}
