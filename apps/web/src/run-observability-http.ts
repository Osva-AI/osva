import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunAttemptId, RunId, RunStepId } from "@osva/contracts";
import {
  createEvaluationRequestSchema,
  evaluationListResourceSchema,
  evaluationResourceSchema,
  listRunStepsQuerySchema,
  runAttemptUsageResourceSchema,
  runStepListResourceSchema,
  runStepResourceSchema,
} from "@osva/contracts/schemas";
import {
  DEFAULT_RUN_STEP_LIST_LIMIT,
  MAX_RUN_STEP_LIST_LIMIT,
  type Evaluation,
  type RunObservabilityApplication,
  type RunStep,
} from "@osva/domain";
import type { EvaluationApplication } from "@osva/domain";

import { requireControlPlaneScope } from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";
import {
  decodeRunStepListCursor,
  encodeRunStepListCursor,
} from "./run-step-cursor.js";

export interface RunObservabilityHttpServices {
  readonly observability: RunObservabilityApplication;
  readonly evaluations: EvaluationApplication;
}

export async function handleRunObservabilityRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: RunObservabilityHttpServices,
): Promise<boolean> {
  const route = matchRunObservabilityRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchRunObservabilityRoute(
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

type RunObservabilityRoute =
  | {
      readonly kind: "steps";
      readonly runId: RunId;
      readonly runAttemptId: RunAttemptId;
    }
  | {
      readonly kind: "step";
      readonly runId: RunId;
      readonly runAttemptId: RunAttemptId;
      readonly runStepId: RunStepId;
    }
  | {
      readonly kind: "usage";
      readonly runId: RunId;
      readonly runAttemptId: RunAttemptId;
    }
  | {
      readonly kind: "evaluations";
      readonly runId: RunId;
      readonly runAttemptId: RunAttemptId;
    }
  | {
      readonly kind: "evaluation";
      readonly runId: RunId;
      readonly runAttemptId: RunAttemptId;
      readonly evaluationId: string;
    };

async function dispatchRunObservabilityRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: RunObservabilityRoute,
  searchParams: URLSearchParams,
  services: RunObservabilityHttpServices,
): Promise<void> {
  const scope = requireControlPlaneScope();
  if (route.kind === "steps") {
    if (method === "GET") {
      await handleListRunSteps(
        response,
        route.runId,
        route.runAttemptId,
        searchParams,
        services.observability,
      );
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "step") {
    if (method === "GET") {
      const step = await services.observability.getRunStep.execute(scope, {
        runId: route.runId,
        runAttemptId: route.runAttemptId,
        runStepId: route.runStepId,
      });
      sendJson(response, 200, toRunStepResource(step));
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "usage") {
    if (method === "GET") {
      const usage = await services.observability.getRunAttemptUsage.execute(
        scope,
        route.runId,
        route.runAttemptId,
      );
      sendJson(response, 200, runAttemptUsageResourceSchema.parse(usage));
      return;
    }

    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (route.kind === "evaluations") {
    if (method === "GET") {
      const evaluations = await services.evaluations.listEvaluations.execute(
        scope,
        route.runId,
        route.runAttemptId,
      );
      sendJson(response, 200, toEvaluationListResource(evaluations));
      return;
    }

    if (method === "POST") {
      const parsed = createEvaluationRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.evaluations.createEvaluation.execute(
        scope,
        {
          runId: route.runId,
          runAttemptId: route.runAttemptId,
          evaluator: parsed.data.evaluator,
        },
      );
      sendJson(response, 201, toEvaluationResource(created));
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

  if (method === "GET") {
    const evaluation = await services.evaluations.getEvaluation.execute(scope, {
      runId: route.runId,
      runAttemptId: route.runAttemptId,
      evaluationId:
        route.evaluationId as import("@osva/contracts").EvaluationId,
    });
    sendJson(response, 200, toEvaluationResource(evaluation));
    return;
  }

  sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
}

async function handleListRunSteps(
  response: ServerResponse,
  runId: RunId,
  runAttemptId: RunAttemptId,
  searchParams: URLSearchParams,
  observability: RunObservabilityApplication,
): Promise<void> {
  const scope = requireControlPlaneScope();
  const parsed = listRunStepsQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  let limit = DEFAULT_RUN_STEP_LIST_LIMIT;
  if (parsed.data.limit !== undefined) {
    limit = Number(parsed.data.limit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_RUN_STEP_LIST_LIMIT
    ) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
  }

  let cursor: { startedAt: Date; id: RunStepId } | undefined;
  if (parsed.data.cursor !== undefined) {
    const decoded = decodeRunStepListCursor(parsed.data.cursor);
    if (decoded === null) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }

    cursor = {
      startedAt: new Date(decoded.startedAt),
      id: decoded.id as RunStepId,
    };
  }

  const page = await observability.listRunSteps.execute(
    scope,
    runId,
    runAttemptId,
    {
      limit,
      cursor,
    },
  );

  sendJson(response, 200, toRunStepListResource(page.steps, page.nextCursor));
}

function matchRunObservabilityRoute(
  path: string,
): RunObservabilityRoute | undefined {
  if (!path.startsWith("/v1/runs/")) {
    return undefined;
  }

  const segments = path
    .slice("/v1/runs/".length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  if (
    segments.length === 4 &&
    segments[1] === "attempts" &&
    segments[3] === "steps"
  ) {
    return {
      kind: "steps",
      runId: segments[0] as RunId,
      runAttemptId: segments[2] as RunAttemptId,
    };
  }

  if (
    segments.length === 5 &&
    segments[1] === "attempts" &&
    segments[3] === "steps"
  ) {
    return {
      kind: "step",
      runId: segments[0] as RunId,
      runAttemptId: segments[2] as RunAttemptId,
      runStepId: segments[4] as RunStepId,
    };
  }

  if (
    segments.length === 4 &&
    segments[1] === "attempts" &&
    segments[3] === "usage"
  ) {
    return {
      kind: "usage",
      runId: segments[0] as RunId,
      runAttemptId: segments[2] as RunAttemptId,
    };
  }

  if (
    segments.length === 4 &&
    segments[1] === "attempts" &&
    segments[3] === "evaluations"
  ) {
    return {
      kind: "evaluations",
      runId: segments[0] as RunId,
      runAttemptId: segments[2] as RunAttemptId,
    };
  }

  if (
    segments.length === 5 &&
    segments[1] === "attempts" &&
    segments[3] === "evaluations"
  ) {
    return {
      kind: "evaluation",
      runId: segments[0] as RunId,
      runAttemptId: segments[2] as RunAttemptId,
      evaluationId: segments[4] as string,
    };
  }

  return undefined;
}

function toRunStepResource(step: RunStep) {
  return runStepResourceSchema.parse({
    id: step.id,
    runId: step.runId,
    runAttemptId: step.runAttemptId,
    kind: step.kind,
    bindingName: step.bindingName,
    status: step.status,
    startedAt: step.startedAt.toISOString(),
    completedAt: step.completedAt?.toISOString(),
    modelProfileVersionId: step.modelProfileVersionId,
    toolVersionId: step.toolVersionId,
    inputTokens: step.inputTokens,
    outputTokens: step.outputTokens,
    totalTokens: step.totalTokens,
    cachedInputTokens: step.cachedInputTokens,
    estimatedCostUsdMicros: step.estimatedCostUsdMicros,
    errorCode: step.errorCode,
  });
}

function toRunStepListResource(
  steps: readonly RunStep[],
  nextCursor: { readonly startedAt: Date; readonly id: RunStepId } | undefined,
) {
  return runStepListResourceSchema.parse({
    steps: steps.map((step) => toRunStepResource(step)),
    nextCursor:
      nextCursor === undefined
        ? undefined
        : encodeRunStepListCursor({
            startedAt: nextCursor.startedAt.toISOString(),
            id: nextCursor.id,
          }),
  });
}

function toEvaluationResource(evaluation: Evaluation) {
  return evaluationResourceSchema.parse({
    id: evaluation.id,
    runId: evaluation.runId,
    runAttemptId: evaluation.runAttemptId,
    evaluatorType: evaluation.evaluatorType,
    expected: evaluation.expected,
    passed: evaluation.passed,
    score: evaluation.score,
    createdAt: evaluation.createdAt.toISOString(),
  });
}

function toEvaluationListResource(evaluations: readonly Evaluation[]) {
  return evaluationListResourceSchema.parse({
    evaluations: evaluations.map((evaluation) =>
      toEvaluationResource(evaluation),
    ),
  });
}
export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/runs/:runId/attempts/:runAttemptId/steps" },
  {
    method: "GET",
    path: "/v1/runs/:runId/attempts/:runAttemptId/steps/:runStepId",
  },
  { method: "GET", path: "/v1/runs/:runId/attempts/:runAttemptId/usage" },
  { method: "GET", path: "/v1/runs/:runId/attempts/:runAttemptId/evaluations" },
  {
    method: "POST",
    path: "/v1/runs/:runId/attempts/:runAttemptId/evaluations",
  },
  {
    method: "GET",
    path: "/v1/runs/:runId/attempts/:runAttemptId/evaluations/:evaluationId",
  },
] as const;
