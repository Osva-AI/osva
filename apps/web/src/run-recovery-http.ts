import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunAttemptId, RunId } from "@osva-ai/contracts";
import {
  resumeRunRequestSchema,
  resumeRunResponseSchema,
  runCheckpointListResourceSchema,
  runRecoveryStatusResourceSchema,
} from "@osva-ai/contracts/schemas";
import {
  CONTROL_PLANE_RESOURCE_KINDS,
  type RunRecoveryApplication,
} from "@osva/domain";
import type { RecoverInterruptedRun } from "@osva/orchestration";

import {
  authorizeControlPlaneExecute,
  requireControlPlaneScope,
  requireControlPlaneWorkspaceId,
} from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export interface RunRecoveryHttpServices {
  readonly recovery: RunRecoveryApplication;
  readonly recoverInterruptedRun: RecoverInterruptedRun;
  readonly clock: { now(): Date };
  readonly ids: { createId(): string };
}

export async function handleRunRecoveryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  services: RunRecoveryHttpServices,
): Promise<boolean> {
  const route = matchRunRecoveryRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    const workspaceId = requireControlPlaneWorkspaceId();
    const scope = requireControlPlaneScope();

    if (route.kind === "checkpoints" && method === "GET") {
      const limitParam = new URL(
        request.url ?? "",
        "http://local",
      ).searchParams.get("limit");
      const limit =
        limitParam === null ? undefined : Number.parseInt(limitParam, 10);
      const checkpoints = await services.recovery.listRunCheckpoints.execute(
        scope,
        route.runId,
        limit,
      );
      sendJson(
        response,
        200,
        runCheckpointListResourceSchema.parse({
          runId: route.runId,
          checkpoints,
        }),
      );
      return true;
    }

    if (route.kind === "recovery" && method === "GET") {
      const status = await services.recovery.getRunRecoveryStatus.execute(
        scope,
        route.runId,
      );
      sendJson(response, 200, toRecoveryStatusResource(status));
      return true;
    }

    if (route.kind === "resume" && method === "POST") {
      authorizeControlPlaneExecute(scope, CONTROL_PLANE_RESOURCE_KINDS.run);
      const body =
        request.headers["content-length"] === "0"
          ? {}
          : await readJsonBody(request);
      resumeRunRequestSchema.parse(body);

      const result = await services.recoverInterruptedRun.execute({
        workspaceId,
        runId: route.runId,
        now: services.clock.now(),
        newRunAttemptId: services.ids.createId() as RunAttemptId,
        automatic: false,
      });

      if (result.outcome === "not_found") {
        sendJson(response, 404, {
          code: "RUN_NOT_FOUND",
          message: "Run was not found.",
        });
        return true;
      }
      if (result.outcome === "ineligible") {
        sendJson(response, 409, {
          code: result.code,
          message: result.message,
        });
        return true;
      }
      if (result.outcome === "conflict") {
        sendJson(response, 409, {
          code: "RECOVERY_CONFLICT",
          message:
            "Recovery could not be scheduled due to a lifecycle conflict.",
        });
        return true;
      }

      sendJson(
        response,
        result.outcome === "already_scheduled" ? 200 : 202,
        resumeRunResponseSchema.parse({
          runId: route.runId,
          runAttemptId: result.runAttemptId,
          outcome: result.outcome,
        }),
      );
      return true;
    }

    sendJson(response, 405, {
      code: "METHOD_NOT_ALLOWED",
      message: "Method not allowed for this run recovery route.",
    });
    return true;
  } catch (error) {
    sendHttpError(response, error);
    return true;
  }
}

type RunRecoveryRoute =
  | { readonly kind: "checkpoints"; readonly runId: RunId }
  | { readonly kind: "recovery"; readonly runId: RunId }
  | { readonly kind: "resume"; readonly runId: RunId };

function matchRunRecoveryRoute(path: string): RunRecoveryRoute | undefined {
  if (!path.startsWith("/v1/runs/")) {
    return undefined;
  }

  const segments = path
    .slice("/v1/runs/".length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  if (segments.length !== 2 || segments[0] === undefined) {
    return undefined;
  }
  const runId = segments[0] as RunId;
  const suffix = segments[1];
  if (suffix === "checkpoints") {
    return { kind: "checkpoints", runId };
  }
  if (suffix === "recovery") {
    return { kind: "recovery", runId };
  }
  if (suffix === "resume") {
    return { kind: "resume", runId };
  }
  return undefined;
}

function toRecoveryStatusResource(
  status: import("@osva/domain").RunRecoveryStatus,
) {
  return runRecoveryStatusResourceSchema.parse({
    runId: status.runId,
    runStatus: status.runStatus,
    eligible: status.eligible,
    ...(status.ineligibleCode !== undefined
      ? { ineligibleCode: status.ineligibleCode }
      : {}),
    ...(status.ineligibleMessage !== undefined
      ? { ineligibleMessage: status.ineligibleMessage }
      : {}),
    ...(status.recovery !== undefined ? { recovery: status.recovery } : {}),
    ...(status.latestCheckpoint !== undefined
      ? { latestCheckpoint: status.latestCheckpoint }
      : {}),
    blockedOperations: status.blockedOperations,
  });
}

export const V1_RUN_RECOVERY_HTTP_ROUTES = [
  { method: "GET", path: "/v1/runs/:runId/checkpoints" },
  { method: "GET", path: "/v1/runs/:runId/recovery" },
  { method: "POST", path: "/v1/runs/:runId/resume" },
] as const;
