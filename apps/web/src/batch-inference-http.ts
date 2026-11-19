import type { IncomingMessage, ServerResponse } from "node:http";
import type { BatchInferenceJobId } from "@osva-ai/contracts";
import {
  BATCH_INFERENCE_CONTRACT_FORMAT_VERSION,
  BATCH_INFERENCE_EXECUTION_MODES,
} from "@osva-ai/contracts";
import { batchInferenceCreateJobRequestSchema } from "@osva-ai/contracts/schemas";
import {
  CONTROL_PLANE_RESOURCE_KINDS,
  type BatchInferenceApplication,
} from "@osva/domain";

import {
  authorizeControlPlaneExecute,
  authorizeControlPlaneRead,
  requireControlPlaneScope,
  requireControlPlaneWorkspaceId,
} from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export interface BatchInferenceHttpServices {
  readonly batchInference: BatchInferenceApplication;
  readonly ids: {
    createJobId(): BatchInferenceJobId;
    createItemId(): import("@osva-ai/contracts").BatchInferenceItemId;
  };
}

export const V1_HTTP_ROUTES = [
  { method: "POST", path: "/v1/batch-inference-jobs" },
  { method: "GET", path: "/v1/batch-inference-jobs" },
  { method: "GET", path: "/v1/batch-inference-jobs/:id" },
  { method: "GET", path: "/v1/batch-inference-jobs/:id/items" },
  { method: "POST", path: "/v1/batch-inference-jobs/:id/cancel" },
] as const;

export async function handleBatchInferenceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: BatchInferenceHttpServices,
): Promise<boolean> {
  const match = matchBatchRoute(path);
  if (match === undefined) return false;
  try {
    const scope = requireControlPlaneScope();
    const batchResource = CONTROL_PLANE_RESOURCE_KINDS.batchInferenceJob;

    if (match.kind === "collection" && method === "POST") {
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const normalized = {
        formatVersion: BATCH_INFERENCE_CONTRACT_FORMAT_VERSION,
        executionMode: BATCH_INFERENCE_EXECUTION_MODES[0],
        ...body,
        jobId:
          typeof body.jobId === "string"
            ? body.jobId
            : services.ids.createJobId(),
        items: Array.isArray(body.items)
          ? body.items.map((item) => {
              const row = item as Record<string, unknown>;
              return {
                ...row,
                itemId:
                  typeof row.itemId === "string"
                    ? row.itemId
                    : services.ids.createItemId(),
              };
            })
          : [],
      };
      const parsed = batchInferenceCreateJobRequestSchema.safeParse(normalized);
      if (!parsed.success) {
        sendHttpError(response, parsed.error);
        return true;
      }
      const workspaceId = requireControlPlaneWorkspaceId();
      if (parsed.data.workspaceId !== workspaceId) {
        sendHttpError(response, new Error("workspace mismatch"));
        return true;
      }
      authorizeControlPlaneExecute(scope, batchResource);
      const created =
        await services.batchInference.createBatchInferenceJob.execute(scope, {
          workspaceId,
          clientIdempotencyKey: parsed.data.submissionFingerprint,
          modelProfileVersionId: parsed.data.modelProfileVersionId,
          providerConnectionVersionId: parsed.data.providerConnectionVersionId,
          items: parsed.data.items,
        });
      sendJson(response, 201, { job: created.job });
      return true;
    }

    if (match.kind === "collection" && method === "GET") {
      authorizeControlPlaneRead(scope, batchResource);
      const limit = Number(searchParams.get("limit") ?? "20");
      const cursor = searchParams.get("cursor") ?? undefined;
      const listed =
        await services.batchInference.listBatchInferenceJobs.execute(scope, {
          limit: Math.min(Math.max(limit, 1), 100),
          cursor,
        });
      sendJson(response, 200, listed);
      return true;
    }

    if (match.kind === "item" && method === "GET") {
      authorizeControlPlaneRead(scope, batchResource);
      const result = await services.batchInference.getBatchInferenceJob.execute(
        scope,
        match.jobId,
      );
      sendJson(response, 200, { job: result.job });
      return true;
    }

    if (match.kind === "items" && method === "GET") {
      authorizeControlPlaneRead(scope, batchResource);
      const limit = Number(searchParams.get("limit") ?? "50");
      const cursor = searchParams.get("cursor") ?? undefined;
      const listed =
        await services.batchInference.listBatchInferenceJobItems.execute(
          scope,
          match.jobId,
          { limit: Math.min(Math.max(limit, 1), 200), cursor },
        );
      sendJson(response, 200, listed);
      return true;
    }

    if (match.kind === "cancel" && method === "POST") {
      authorizeControlPlaneExecute(scope, batchResource);
      const result =
        await services.batchInference.cancelBatchInferenceJob.execute(
          scope,
          match.jobId,
        );
      sendJson(response, 200, { job: result.job });
      return true;
    }

    response.statusCode = 405;
    response.end();
    return true;
  } catch (error) {
    sendHttpError(response, error);
    return true;
  }
}

type BatchRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly jobId: BatchInferenceJobId }
  | { readonly kind: "items"; readonly jobId: BatchInferenceJobId }
  | { readonly kind: "cancel"; readonly jobId: BatchInferenceJobId };

function matchBatchRoute(path: string): BatchRoute | undefined {
  if (path === "/v1/batch-inference-jobs") {
    return { kind: "collection" };
  }
  const item = path.match(/^\/v1\/batch-inference-jobs\/([^/]+)$/);
  if (item) {
    return { kind: "item", jobId: item[1] as BatchInferenceJobId };
  }
  const items = path.match(/^\/v1\/batch-inference-jobs\/([^/]+)\/items$/);
  if (items) {
    return { kind: "items", jobId: items[1] as BatchInferenceJobId };
  }
  const cancel = path.match(/^\/v1\/batch-inference-jobs\/([^/]+)\/cancel$/);
  if (cancel) {
    return { kind: "cancel", jobId: cancel[1] as BatchInferenceJobId };
  }
  return undefined;
}
