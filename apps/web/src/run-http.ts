import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunAttemptId, RunId } from "@osva/contracts";
import {
  createRunRequestSchema,
  createRunResponseSchema,
  listRunsQuerySchema,
  runAttemptListResourceSchema,
  runAttemptResourceSchema,
  runListResourceSchema,
  runResourceSchema,
} from "@osva/contracts/schemas";
import {
  DEFAULT_RUN_LIST_LIMIT,
  MAX_RUN_LIST_LIMIT,
  type Run,
  type RunApplication,
  type RunAttempt,
} from "@osva/domain";
import type { CreateRun } from "@osva/orchestration";

import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";
import { decodeRunListCursor, encodeRunListCursor } from "./run-cursor.js";

export interface RunHttpClock {
  now(): Date;
}

export interface RunHttpIds {
  createId(): string;
}

export interface RunHttpServices {
  readonly runs: RunApplication;
  readonly createRun: CreateRun;
  readonly clock: RunHttpClock;
  readonly ids: RunHttpIds;
}

export async function handleRunRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: RunHttpServices,
): Promise<boolean> {
  const route = matchRunRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchRunRoute(
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

type RunRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly runId: RunId }
  | { readonly kind: "attempts"; readonly runId: RunId }
  | {
      readonly kind: "attempt";
      readonly runId: RunId;
      readonly runAttemptId: RunAttemptId;
    };

async function dispatchRunRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: RunRoute,
  searchParams: URLSearchParams,
  services: RunHttpServices,
): Promise<void> {
  if (route.kind === "collection") {
    if (method === "GET") {
      await handleListRuns(response, searchParams, services.runs);
      return;
    }

    if (method === "POST") {
      const parsed = createRunRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.createRun.execute({
        runId: services.ids.createId() as RunId,
        runAttemptId: services.ids.createId() as RunAttemptId,
        workspaceId: parsed.data.workspaceId,
        agentId: parsed.data.agentId,
        agentVersionId: parsed.data.agentVersionId,
        input: parsed.data.input,
        idempotencyKey: parsed.data.idempotencyKey,
        now: services.clock.now(),
      });
      sendJson(
        response,
        201,
        toCreateRunResponse(created.run, created.runAttempt),
      );
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
      const run = await services.runs.getRun.execute(route.runId);
      sendJson(response, 200, toRunResource(run));
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "attempts") {
    if (method === "GET") {
      const attempts = await services.runs.listRunAttempts.execute(route.runId);
      sendJson(response, 200, toRunAttemptListResource(attempts));
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (method === "GET") {
    const attempt = await services.runs.getRunAttempt.execute({
      runId: route.runId,
      runAttemptId: route.runAttemptId,
    });
    sendJson(response, 200, toRunAttemptResource(attempt));
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

async function handleListRuns(
  response: ServerResponse,
  searchParams: URLSearchParams,
  runs: RunApplication,
): Promise<void> {
  const parsed = listRunsQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  let limit = DEFAULT_RUN_LIST_LIMIT;
  if (parsed.data.limit !== undefined) {
    limit = Number(parsed.data.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN_LIST_LIMIT) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
  }

  let cursor: { createdAt: Date; id: RunId } | undefined;
  if (parsed.data.cursor !== undefined) {
    const decoded = decodeRunListCursor(parsed.data.cursor);
    if (decoded === null) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }

    cursor = {
      createdAt: new Date(decoded.createdAt),
      id: decoded.id as RunId,
    };
  }

  const page = await runs.listRuns.execute({
    limit,
    cursor,
    agentId: parsed.data.agentId,
    agentVersionId: parsed.data.agentVersionId,
    status: parsed.data.status,
  });

  sendJson(response, 200, toRunListResource(page.runs, page.nextCursor));
}

function matchRunRoute(path: string): RunRoute | undefined {
  if (path === "/v1/runs" || path === "/v1/runs/") {
    return { kind: "collection" };
  }

  if (!path.startsWith("/v1/runs/")) {
    return undefined;
  }

  const segments = path
    .slice("/v1/runs/".length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length === 1 && segments[0] !== undefined) {
    return { kind: "item", runId: segments[0] as RunId };
  }

  if (
    segments.length === 2 &&
    segments[0] !== undefined &&
    segments[1] === "attempts"
  ) {
    return { kind: "attempts", runId: segments[0] as RunId };
  }

  if (
    segments.length === 3 &&
    segments[0] !== undefined &&
    segments[1] === "attempts" &&
    segments[2] !== undefined
  ) {
    return {
      kind: "attempt",
      runId: segments[0] as RunId,
      runAttemptId: segments[2] as RunAttemptId,
    };
  }

  return undefined;
}

function toRunResource(run: Run) {
  return runResourceSchema.parse({
    id: run.id,
    workspaceId: run.workspaceId,
    agentId: run.agentId,
    status: run.status,
    effectiveBindings: {
      agentVersionId: run.effectiveBindings.agentVersionId,
      modelProfileVersionBindings:
        run.effectiveBindings.modelProfileVersionBindings,
      toolVersionBindings: run.effectiveBindings.toolVersionBindings,
    },
    input: run.input,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    idempotencyKey: run.idempotencyKey,
  });
}

function toRunAttemptResource(attempt: RunAttempt) {
  return runAttemptResourceSchema.parse({
    id: attempt.id,
    runId: attempt.runId,
    sequence: attempt.sequence,
    status: attempt.status,
    createdAt: attempt.createdAt.toISOString(),
    startedAt: attempt.startedAt?.toISOString(),
    completedAt: attempt.completedAt?.toISOString(),
    error: attempt.error,
    ...(attempt.output !== undefined ? { output: attempt.output } : {}),
  });
}

function toCreateRunResponse(run: Run, attempt: RunAttempt) {
  return createRunResponseSchema.parse({
    run: toRunResource(run),
    runAttempt: toRunAttemptResource(attempt),
  });
}

function toRunListResource(
  page: readonly Run[],
  nextCursor: { readonly createdAt: Date; readonly id: RunId } | undefined,
) {
  return runListResourceSchema.parse({
    runs: page.map((run) => toRunResource(run)),
    nextCursor:
      nextCursor === undefined
        ? undefined
        : encodeRunListCursor({
            createdAt: nextCursor.createdAt.toISOString(),
            id: nextCursor.id,
          }),
  });
}

function toRunAttemptListResource(attempts: readonly RunAttempt[]) {
  return runAttemptListResourceSchema.parse({
    attempts: attempts.map((attempt) => toRunAttemptResource(attempt)),
  });
}
