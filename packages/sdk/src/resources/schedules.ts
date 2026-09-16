import type { ScheduleId } from "@osva/contracts";
import {
  createScheduleRequestSchema,
  scheduleListResourceSchema,
  scheduleOccurrenceListResourceSchema,
  scheduleResourceSchema,
  updateScheduleRequestSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;
type ScheduleListResource = z.infer<typeof scheduleListResourceSchema>;
type ScheduleOccurrenceListResource = z.infer<
  typeof scheduleOccurrenceListResourceSchema
>;
type ScheduleResource = z.infer<typeof scheduleResourceSchema>;
type UpdateScheduleRequest = z.infer<typeof updateScheduleRequestSchema>;

export interface ListSchedulesParams {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ListScheduleOccurrencesParams {
  readonly limit?: number;
  readonly cursor?: string;
}

export class SchedulesResource {
  constructor(
    private readonly client: OsvaHttpClient,
    private readonly workspaceId: string,
  ) {}

  list(params: ListSchedulesParams = {}): Promise<ScheduleListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/schedules",
      query: {
        workspaceId: this.workspaceId,
        limit: params.limit === undefined ? undefined : String(params.limit),
        cursor: params.cursor,
      },
    });
  }

  get(scheduleId: ScheduleId): Promise<ScheduleResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/schedules/${encodeURIComponent(scheduleId)}`,
    });
  }

  create(
    input: Omit<CreateScheduleRequest, "workspaceId">,
  ): Promise<ScheduleResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/schedules",
      body: {
        ...input,
        workspaceId: this.workspaceId,
      },
    });
  }

  update(
    scheduleId: ScheduleId,
    input: UpdateScheduleRequest,
  ): Promise<ScheduleResource> {
    return this.client.request({
      method: "PATCH",
      path: `/v1/schedules/${encodeURIComponent(scheduleId)}`,
      body: input,
    });
  }

  listOccurrences(
    scheduleId: ScheduleId,
    params: ListScheduleOccurrencesParams = {},
  ): Promise<ScheduleOccurrenceListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/schedules/${encodeURIComponent(scheduleId)}/occurrences`,
      query: {
        limit: params.limit === undefined ? undefined : String(params.limit),
        cursor: params.cursor,
      },
    });
  }
}
