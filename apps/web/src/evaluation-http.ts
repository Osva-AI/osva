import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AgentVersionId,
  EvaluationRunId,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
} from "@osva-ai/contracts";
import {
  createEvaluationRunRequestSchema,
  createEvaluationSuiteRequestSchema,
  createEvaluationSuiteVersionRequestSchema,
  evaluationCaseResultListResourceSchema,
  evaluationRunDetailResourceSchema,
  evaluationRunListResourceSchema,
  evaluationRunResourceSchema,
  evaluationSuiteListResourceSchema,
  evaluationSuiteResourceSchema,
  evaluationSuiteVersionListResourceSchema,
  evaluationSuiteVersionResourceSchema,
  listEvaluationRunsQuerySchema,
} from "@osva-ai/contracts/schemas";
import type {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationRun,
  EvaluationRunApplication,
  EvaluationSuite,
  EvaluationSuiteApplication,
  EvaluationSuiteVersion,
} from "@osva/domain";
import {
  DEFAULT_EVALUATION_RUN_LIST_LIMIT,
  MAX_EVALUATION_RUN_LIST_LIMIT,
} from "@osva/domain";

import {
  requireControlPlaneScope,
  requireControlPlaneWorkspaceId,
} from "./control-plane-http.js";
import {
  decodeEvaluationRunListCursor,
  encodeEvaluationRunListCursor,
} from "./evaluation-run-cursor.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export interface EvaluationHttpServices {
  readonly suites: EvaluationSuiteApplication;
  readonly runs: EvaluationRunApplication;
}

export async function handleEvaluationRegistryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: EvaluationHttpServices,
): Promise<boolean> {
  const route = matchEvaluationRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchEvaluationRoute(
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

type EvaluationRoute =
  | { readonly kind: "suites" }
  | { readonly kind: "suite"; readonly evaluationSuiteId: EvaluationSuiteId }
  | {
      readonly kind: "suite-versions";
      readonly evaluationSuiteId: EvaluationSuiteId;
    }
  | {
      readonly kind: "suite-version";
      readonly evaluationSuiteId: EvaluationSuiteId;
      readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
    }
  | { readonly kind: "runs" }
  | { readonly kind: "run"; readonly evaluationRunId: EvaluationRunId }
  | {
      readonly kind: "run-case-results";
      readonly evaluationRunId: EvaluationRunId;
    };

async function dispatchEvaluationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: EvaluationRoute,
  searchParams: URLSearchParams,
  services: EvaluationHttpServices,
): Promise<void> {
  const scope = requireControlPlaneScope();
  if (route.kind === "suites") {
    if (method === "GET") {
      const list = await services.suites.listEvaluationSuites.execute(scope);
      sendJson(response, 200, toEvaluationSuiteListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createEvaluationSuiteRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.suites.createEvaluationSuite.execute(
        scope,
        {
          ...parsed.data,
          workspaceId: requireControlPlaneWorkspaceId(),
        },
      );
      sendJson(response, 201, toEvaluationSuiteResource(created));
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

  if (route.kind === "suite") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }

    const suite = await services.suites.getEvaluationSuite.execute(
      scope,
      route.evaluationSuiteId,
    );
    sendJson(response, 200, toEvaluationSuiteResource(suite));
    return;
  }

  if (route.kind === "suite-versions") {
    if (method === "GET") {
      const versions =
        await services.suites.listEvaluationSuiteVersions.execute(
          scope,
          route.evaluationSuiteId,
        );
      sendJson(response, 200, toEvaluationSuiteVersionListResource(versions));
      return;
    }

    if (method === "POST") {
      const parsed = createEvaluationSuiteVersionRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created =
        await services.suites.appendEvaluationSuiteVersion.execute(scope, {
          evaluationSuiteId: route.evaluationSuiteId,
          cases: parsed.data.cases,
        });
      sendJson(response, 201, toEvaluationSuiteVersionResource(created));
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

  if (route.kind === "suite-version") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }

    const version = await services.suites.getEvaluationSuiteVersion.execute(
      scope,
      {
        evaluationSuiteId: route.evaluationSuiteId,
        evaluationSuiteVersionId: route.evaluationSuiteVersionId,
      },
    );
    sendJson(response, 200, toEvaluationSuiteVersionResource(version));
    return;
  }

  if (route.kind === "runs") {
    if (method === "GET") {
      await handleListEvaluationRuns(response, searchParams, services.runs);
      return;
    }

    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET, POST" },
      );
      return;
    }

    const parsed = createEvaluationRunRequestSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }

    const launched = await services.runs.launchEvaluationRun.execute(scope, {
      ...parsed.data,
      workspaceId: requireControlPlaneWorkspaceId(),
    });
    const detail = await services.runs.getEvaluationRun.execute(
      scope,
      launched.id,
    );
    sendJson(
      response,
      201,
      toEvaluationRunDetailResource(detail.evaluationRun, detail.summary),
    );
    return;
  }

  if (route.kind === "run-case-results") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }

    const results = await services.runs.listEvaluationCaseResults.execute(
      scope,
      route.evaluationRunId,
    );
    sendJson(response, 200, toEvaluationCaseResultListResource(results));
    return;
  }

  if (method !== "GET") {
    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  const detail = await services.runs.getEvaluationRun.execute(
    scope,
    route.evaluationRunId,
  );
  sendJson(
    response,
    200,
    toEvaluationRunDetailResource(detail.evaluationRun, detail.summary),
  );
}

function matchEvaluationRoute(path: string): EvaluationRoute | undefined {
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (
    segments.length === 2 &&
    segments[0] === "v1" &&
    segments[1] === "evaluation-suites"
  ) {
    return { kind: "suites" };
  }

  if (
    segments.length === 2 &&
    segments[0] === "v1" &&
    segments[1] === "evaluation-runs"
  ) {
    return { kind: "runs" };
  }

  if (
    segments.length === 3 &&
    segments[0] === "v1" &&
    segments[1] === "evaluation-suites"
  ) {
    return {
      kind: "suite",
      evaluationSuiteId: decodeURIComponent(segments[2]!) as EvaluationSuiteId,
    };
  }

  if (
    segments.length === 3 &&
    segments[0] === "v1" &&
    segments[1] === "evaluation-runs"
  ) {
    return {
      kind: "run",
      evaluationRunId: decodeURIComponent(segments[2]!) as EvaluationRunId,
    };
  }

  if (
    segments.length === 4 &&
    segments[0] === "v1" &&
    segments[1] === "evaluation-suites" &&
    segments[3] === "versions"
  ) {
    return {
      kind: "suite-versions",
      evaluationSuiteId: decodeURIComponent(segments[2]!) as EvaluationSuiteId,
    };
  }

  if (
    segments.length === 5 &&
    segments[0] === "v1" &&
    segments[1] === "evaluation-suites" &&
    segments[3] === "versions"
  ) {
    return {
      kind: "suite-version",
      evaluationSuiteId: decodeURIComponent(segments[2]!) as EvaluationSuiteId,
      evaluationSuiteVersionId: decodeURIComponent(
        segments[4]!,
      ) as EvaluationSuiteVersionId,
    };
  }

  if (
    segments.length === 4 &&
    segments[0] === "v1" &&
    segments[1] === "evaluation-runs" &&
    segments[3] === "case-results"
  ) {
    return {
      kind: "run-case-results",
      evaluationRunId: decodeURIComponent(segments[2]!) as EvaluationRunId,
    };
  }

  return undefined;
}

async function handleListEvaluationRuns(
  response: ServerResponse,
  searchParams: URLSearchParams,
  runs: EvaluationRunApplication,
): Promise<void> {
  const scope = requireControlPlaneScope();
  const parsed = listEvaluationRunsQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  let limit = DEFAULT_EVALUATION_RUN_LIST_LIMIT;
  if (parsed.data.limit !== undefined) {
    limit = Number(parsed.data.limit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_EVALUATION_RUN_LIST_LIMIT
    ) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
  }

  let cursor: { createdAt: Date; id: EvaluationRunId } | undefined;
  if (parsed.data.cursor !== undefined) {
    const decoded = decodeEvaluationRunListCursor(parsed.data.cursor);
    if (decoded === null) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }

    cursor = {
      createdAt: new Date(decoded.createdAt),
      id: decoded.id as EvaluationRunId,
    };
  }

  const page = await runs.listEvaluationRuns.execute(scope, {
    limit,
    cursor,
    evaluationSuiteId: parsed.data.evaluationSuiteId,
    evaluationSuiteVersionId: parsed.data.evaluationSuiteVersionId,
    agentVersionId: parsed.data.agentVersionId as AgentVersionId | undefined,
    status: parsed.data.status,
  });

  sendJson(
    response,
    200,
    toEvaluationRunListResource(page.evaluationRuns, page.nextCursor),
  );
}

function toEvaluationRunResource(evaluationRun: EvaluationRun) {
  return evaluationRunResourceSchema.parse({
    id: evaluationRun.id,
    workspaceId: evaluationRun.workspaceId,
    evaluationSuiteVersionId: evaluationRun.evaluationSuiteVersionId,
    targetType: evaluationRun.targetType,
    targetVersionId: evaluationRun.targetVersionId,
    status: evaluationRun.status,
    createdAt: evaluationRun.createdAt.toISOString(),
    startedAt: evaluationRun.startedAt?.toISOString(),
    completedAt: evaluationRun.completedAt?.toISOString(),
    cancelledAt: evaluationRun.cancelledAt?.toISOString(),
  });
}

function toEvaluationRunListResource(
  page: readonly EvaluationRun[],
  nextCursor:
    { readonly createdAt: Date; readonly id: EvaluationRunId } | undefined,
) {
  return evaluationRunListResourceSchema.parse({
    items: page.map((evaluationRun) => toEvaluationRunResource(evaluationRun)),
    nextCursor:
      nextCursor === undefined
        ? undefined
        : encodeEvaluationRunListCursor({
            createdAt: nextCursor.createdAt.toISOString(),
            id: nextCursor.id,
          }),
  });
}

function toEvaluationSuiteResource(suite: EvaluationSuite) {
  return evaluationSuiteResourceSchema.parse({
    id: suite.id,
    workspaceId: suite.workspaceId,
    key: suite.key,
    name: suite.name,
    description: suite.description,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
  });
}

function toEvaluationSuiteListResource(items: readonly EvaluationSuite[]) {
  return evaluationSuiteListResourceSchema.parse({
    items: items.map((suite) => toEvaluationSuiteResource(suite)),
  });
}

function toEvaluationCaseResource(evaluationCase: EvaluationCase) {
  return {
    id: evaluationCase.id,
    evaluationSuiteVersionId: evaluationCase.evaluationSuiteVersionId,
    key: evaluationCase.key,
    name: evaluationCase.name,
    input: evaluationCase.input,
    expected: evaluationCase.expected,
    evaluator: evaluationCase.evaluator,
    createdAt: evaluationCase.createdAt.toISOString(),
  };
}

function toEvaluationSuiteVersionResource(version: EvaluationSuiteVersion) {
  return evaluationSuiteVersionResourceSchema.parse({
    id: version.id,
    evaluationSuiteId: version.evaluationSuiteId,
    version: version.version,
    cases: version.cases.map((evaluationCase) =>
      toEvaluationCaseResource(evaluationCase),
    ),
    createdAt: version.createdAt.toISOString(),
  });
}

function toEvaluationSuiteVersionListResource(
  versions: readonly EvaluationSuiteVersion[],
) {
  return evaluationSuiteVersionListResourceSchema.parse({
    items: versions.map((version) => toEvaluationSuiteVersionResource(version)),
  });
}

function toEvaluationRunDetailResource(
  evaluationRun: Awaited<
    ReturnType<EvaluationRunApplication["getEvaluationRun"]["execute"]>
  >["evaluationRun"],
  summary: Awaited<
    ReturnType<EvaluationRunApplication["getEvaluationRun"]["execute"]>
  >["summary"],
) {
  return evaluationRunDetailResourceSchema.parse({
    ...toEvaluationRunResource(evaluationRun),
    summary,
  });
}

function toEvaluationCaseResultListResource(
  results: readonly EvaluationCaseResult[],
) {
  return evaluationCaseResultListResourceSchema.parse({
    items: results.map((result) => ({
      id: result.id,
      evaluationRunId: result.evaluationRunId,
      evaluationCaseId: result.evaluationCaseId,
      runId: result.runId,
      outcome: result.outcome,
      evaluatorResults: result.evaluatorResults,
      createdAt: result.createdAt.toISOString(),
      completedAt: result.completedAt?.toISOString(),
    })),
  });
}
export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/evaluation-suites" },
  { method: "POST", path: "/v1/evaluation-suites" },
  { method: "GET", path: "/v1/evaluation-suites/:evaluationSuiteId" },
  { method: "GET", path: "/v1/evaluation-suites/:evaluationSuiteId/versions" },
  { method: "POST", path: "/v1/evaluation-suites/:evaluationSuiteId/versions" },
  {
    method: "GET",
    path: "/v1/evaluation-suites/:evaluationSuiteId/versions/:evaluationSuiteVersionId",
  },
  { method: "GET", path: "/v1/evaluation-runs" },
  { method: "POST", path: "/v1/evaluation-runs" },
  { method: "GET", path: "/v1/evaluation-runs/:evaluationRunId" },
  { method: "GET", path: "/v1/evaluation-runs/:evaluationRunId/case-results" },
] as const;
