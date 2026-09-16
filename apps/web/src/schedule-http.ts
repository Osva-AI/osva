import type { IncomingMessage, ServerResponse } from "node:http";
import type { ScheduleId } from "@osva/contracts";
import {
  createScheduleRequestSchema,
  listScheduleOccurrencesQuerySchema,
  listSchedulesQuerySchema,
  scheduleListResourceSchema,
  scheduleOccurrenceListResourceSchema,
  scheduleResourceSchema,
  updateScheduleRequestSchema,
} from "@osva/contracts/schemas";
import {
  DEFAULT_SCHEDULE_LIST_LIMIT,
  DEFAULT_SCHEDULE_OCCURRENCE_LIST_LIMIT,
  MAX_SCHEDULE_LIST_LIMIT,
  MAX_SCHEDULE_OCCURRENCE_LIST_LIMIT,
  type Schedule,
  type ScheduleApplication,
  type ScheduleOccurrence,
} from "@osva/domain";

import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";
import {
  decodeScheduleListCursor,
  decodeScheduleOccurrenceListCursor,
  encodeScheduleListCursor,
  encodeScheduleOccurrenceListCursor,
} from "./schedule-cursor.js";

export interface ScheduleHttpClock {
  now(): Date;
}

export interface ScheduleHttpIds {
  createId(): string;
}

export interface ScheduleHttpServices {
  readonly schedules: ScheduleApplication;
  readonly clock: ScheduleHttpClock;
  readonly ids: ScheduleHttpIds;
}

export async function handleScheduleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: ScheduleHttpServices,
): Promise<boolean> {
  const route = matchScheduleRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchScheduleRoute(
      request,
      response,
      method,
      route,
      searchParams,
      services,
    );
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type ScheduleRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly scheduleId: ScheduleId }
  | { readonly kind: "occurrences"; readonly scheduleId: ScheduleId };

async function dispatchScheduleRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: ScheduleRoute,
  searchParams: URLSearchParams,
  services: ScheduleHttpServices,
): Promise<void> {
  if (route.kind === "collection") {
    if (method === "GET") {
      await handleListSchedules(response, searchParams, services.schedules);
      return;
    }

    if (method === "POST") {
      const parsed = createScheduleRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.schedules.createSchedule.execute({
        workspaceId: parsed.data.workspaceId,
        key: parsed.data.key,
        name: parsed.data.name,
        agentId: parsed.data.agentId,
        agentVersionId: parsed.data.agentVersionId,
        cronExpression: parsed.data.cronExpression,
        timezone: parsed.data.timezone,
        input: parsed.data.input,
        enabled: parsed.data.enabled,
      });
      sendJson(response, 201, toScheduleResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "item") {
    if (method === "GET") {
      const schedule = await services.schedules.getSchedule.execute(
        route.scheduleId,
      );
      sendJson(response, 200, toScheduleResource(schedule));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateScheduleRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await services.schedules.updateSchedule.execute({
        scheduleId: route.scheduleId,
        ...parsed.data,
      });
      sendJson(response, 200, toScheduleResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, PATCH" },
    );
    return;
  }

  if (method === "GET") {
    await handleListScheduleOccurrences(
      response,
      route.scheduleId,
      searchParams,
      services.schedules,
    );
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

async function handleListSchedules(
  response: ServerResponse,
  searchParams: URLSearchParams,
  schedules: ScheduleApplication,
): Promise<void> {
  const parsed = listSchedulesQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  let limit = DEFAULT_SCHEDULE_LIST_LIMIT;
  if (parsed.data.limit !== undefined) {
    limit = Number(parsed.data.limit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_SCHEDULE_LIST_LIMIT
    ) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
  }

  const cursor =
    parsed.data.cursor === undefined
      ? undefined
      : decodeScheduleListCursor(parsed.data.cursor);
  if (parsed.data.cursor !== undefined && cursor === null) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  const result = await schedules.listSchedules.execute({
    workspaceId: parsed.data.workspaceId,
    limit,
    cursor:
      cursor === null || cursor === undefined
        ? undefined
        : {
            createdAt: new Date(cursor.createdAt),
            id: cursor.id as ScheduleId,
          },
  });

  sendJson(response, 200, toScheduleListResource(result));
}

async function handleListScheduleOccurrences(
  response: ServerResponse,
  scheduleId: ScheduleId,
  searchParams: URLSearchParams,
  schedules: ScheduleApplication,
): Promise<void> {
  const parsed = listScheduleOccurrencesQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  let limit = DEFAULT_SCHEDULE_OCCURRENCE_LIST_LIMIT;
  if (parsed.data.limit !== undefined) {
    limit = Number(parsed.data.limit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_SCHEDULE_OCCURRENCE_LIST_LIMIT
    ) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
  }

  const cursor =
    parsed.data.cursor === undefined
      ? undefined
      : decodeScheduleOccurrenceListCursor(parsed.data.cursor);
  if (parsed.data.cursor !== undefined && cursor === null) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  const result = await schedules.listScheduleOccurrences.execute({
    scheduleId,
    query: {
      scheduleId,
      limit,
      cursor:
        cursor === null || cursor === undefined
          ? undefined
          : {
              scheduledFor: new Date(cursor.scheduledFor),
              id: cursor.id as ScheduleOccurrence["id"],
            },
    },
  });

  sendJson(response, 200, toScheduleOccurrenceListResource(result));
}

function matchScheduleRoute(path: string): ScheduleRoute | undefined {
  if (path === "/v1/schedules") {
    return { kind: "collection" };
  }

  const itemMatch = /^\/v1\/schedules\/([^/]+)$/.exec(path);
  if (itemMatch) {
    return { kind: "item", scheduleId: itemMatch[1] as ScheduleId };
  }

  const occurrencesMatch = /^\/v1\/schedules\/([^/]+)\/occurrences$/.exec(path);
  if (occurrencesMatch) {
    return {
      kind: "occurrences",
      scheduleId: occurrencesMatch[1] as ScheduleId,
    };
  }

  return undefined;
}

function toScheduleResource(schedule: Schedule) {
  return scheduleResourceSchema.parse({
    id: schedule.id,
    workspaceId: schedule.workspaceId,
    key: schedule.key,
    name: schedule.name,
    agentId: schedule.agentId,
    agentVersionId: schedule.agentVersionId,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    input: schedule.input,
    enabled: schedule.enabled,
    nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  });
}

function toScheduleListResource(result: {
  readonly schedules: readonly Schedule[];
  readonly nextCursor?: { readonly createdAt: Date; readonly id: ScheduleId };
}) {
  return scheduleListResourceSchema.parse({
    schedules: result.schedules.map((schedule) => toScheduleResource(schedule)),
    nextCursor:
      result.nextCursor === undefined
        ? undefined
        : encodeScheduleListCursor({
            createdAt: result.nextCursor.createdAt.toISOString(),
            id: result.nextCursor.id,
          }),
  });
}

function toScheduleOccurrenceResource(occurrence: ScheduleOccurrence) {
  return {
    id: occurrence.id,
    scheduleId: occurrence.scheduleId,
    scheduledFor: occurrence.scheduledFor.toISOString(),
    agentVersionId: occurrence.agentVersionId,
    runId: occurrence.runId,
    createdAt: occurrence.createdAt.toISOString(),
    dispatchedAt: occurrence.dispatchedAt?.toISOString() ?? null,
  };
}

function toScheduleOccurrenceListResource(result: {
  readonly occurrences: readonly ScheduleOccurrence[];
  readonly nextCursor?: {
    readonly scheduledFor: Date;
    readonly id: ScheduleOccurrence["id"];
  };
}) {
  return scheduleOccurrenceListResourceSchema.parse({
    occurrences: result.occurrences.map((occurrence) =>
      toScheduleOccurrenceResource(occurrence),
    ),
    nextCursor:
      result.nextCursor === undefined
        ? undefined
        : encodeScheduleOccurrenceListCursor({
            scheduledFor: result.nextCursor.scheduledFor.toISOString(),
            id: result.nextCursor.id,
          }),
  });
}
