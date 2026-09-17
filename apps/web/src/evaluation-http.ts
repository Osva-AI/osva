import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  EvaluationRunId,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  createEvaluationRunRequestSchema,
  createEvaluationSuiteRequestSchema,
  createEvaluationSuiteVersionRequestSchema,
  evaluationCaseResultListResourceSchema,
  evaluationRunDetailResourceSchema,
  evaluationSuiteListResourceSchema,
  evaluationSuiteResourceSchema,
  evaluationSuiteVersionListResourceSchema,
  evaluationSuiteVersionResourceSchema,
  workspaceIdSchema,
} from "@osva/contracts/schemas";
import type {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationRunApplication,
  EvaluationSuite,
  EvaluationSuiteApplication,
  EvaluationSuiteVersion,
} from "@osva/domain";

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
  if (route.kind === "suites") {
    if (method === "GET") {
      const workspaceId = workspaceIdSchema.safeParse(
        searchParams.get("workspaceId") ?? undefined,
      );
      if (!workspaceId.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const list = await services.suites.listEvaluationSuites.execute(
        workspaceId.data as WorkspaceId,
      );
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
        parsed.data,
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
      route.evaluationSuiteId,
    );
    sendJson(response, 200, toEvaluationSuiteResource(suite));
    return;
  }

  if (route.kind === "suite-versions") {
    if (method === "GET") {
      const versions =
        await services.suites.listEvaluationSuiteVersions.execute(
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
        await services.suites.appendEvaluationSuiteVersion.execute({
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

    const version = await services.suites.getEvaluationSuiteVersion.execute({
      evaluationSuiteId: route.evaluationSuiteId,
      evaluationSuiteVersionId: route.evaluationSuiteVersionId,
    });
    sendJson(response, 200, toEvaluationSuiteVersionResource(version));
    return;
  }

  if (route.kind === "runs") {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "POST" },
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

    const launched = await services.runs.launchEvaluationRun.execute(
      parsed.data,
    );
    const detail = await services.runs.getEvaluationRun.execute(launched.id);
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
