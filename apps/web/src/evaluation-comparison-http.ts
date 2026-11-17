import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  EvaluationComparisonId,
  EvaluationComparisonHumanReviewRevisionId,
  SecurityAuditEventId,
} from "@osva-ai/contracts";
import {
  createEvaluationComparisonRequestSchema,
  evaluationComparisonAssessmentResourceSchema,
  evaluationComparisonCalibrationResourceSchema,
  evaluationComparisonHumanReviewListResourceSchema,
  evaluationComparisonHumanReviewResourceSchema,
  evaluationComparisonListResourceSchema,
  evaluationComparisonPairwiseResultListResourceSchema,
  evaluationComparisonResourceSchema,
  listEvaluationComparisonsQuerySchema,
  submitEvaluationComparisonHumanReviewRequestSchema,
} from "@osva-ai/contracts/schemas";
import {
  appendSecurityAuditEvent,
  buildEvaluationComparisonHumanReviewSubmittedAuditEvent,
  controlPlaneAuditActor,
  DEFAULT_EVALUATION_COMPARISON_LIST_LIMIT,
  HumanPrincipalRequiredError,
  MAX_EVALUATION_COMPARISON_LIST_LIMIT,
  type EvaluationComparison,
  type EvaluationComparisonApplication,
  type EvaluationComparisonHumanReviewRevision,
  type EvaluationComparisonPairwiseTask,
  type SecurityAuditEventRepository,
} from "@osva/domain";
import { isHumanSessionRequestPrincipal } from "@osva-ai/contracts";

import { requireControlPlaneScope } from "./control-plane-http.js";
import {
  decodeEvaluationComparisonListCursor,
  encodeEvaluationComparisonListCursor,
} from "./evaluation-comparison-cursor.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export interface EvaluationComparisonHttpServices {
  readonly comparisons: EvaluationComparisonApplication;
  readonly securityAuditEvents?: SecurityAuditEventRepository;
  readonly clock?: { now(): Date };
  readonly ids?: { createId(): string };
}

type ComparisonRoute =
  | { readonly kind: "comparisons" }
  | {
      readonly kind: "comparison";
      readonly comparisonId: EvaluationComparisonId;
    }
  | {
      readonly kind: "pairwise-results";
      readonly comparisonId: EvaluationComparisonId;
    }
  | {
      readonly kind: "assessment";
      readonly comparisonId: EvaluationComparisonId;
    }
  | {
      readonly kind: "human-reviews";
      readonly comparisonId: EvaluationComparisonId;
    }
  | {
      readonly kind: "calibration";
      readonly comparisonId: EvaluationComparisonId;
    };

export function matchEvaluationComparisonRoute(
  path: string,
): ComparisonRoute | undefined {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2 || segments[0] !== "v1") {
    return undefined;
  }
  if (segments[1] !== "evaluation-comparisons") {
    return undefined;
  }

  if (segments.length === 2) {
    return { kind: "comparisons" };
  }

  const comparisonId = decodeURIComponent(
    segments[2]!,
  ) as EvaluationComparisonId;

  if (segments.length === 3) {
    return { kind: "comparison", comparisonId };
  }

  if (segments.length === 4) {
    const sub = segments[3]!;
    if (sub === "pairwise-results") {
      return { kind: "pairwise-results", comparisonId };
    }
    if (sub === "assessment") {
      return { kind: "assessment", comparisonId };
    }
    if (sub === "human-reviews") {
      return { kind: "human-reviews", comparisonId };
    }
    if (sub === "calibration") {
      return { kind: "calibration", comparisonId };
    }
  }

  return undefined;
}

export async function handleEvaluationComparisonRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: EvaluationComparisonHttpServices,
): Promise<boolean> {
  const route = matchEvaluationComparisonRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchEvaluationComparisonRoute(
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

async function dispatchEvaluationComparisonRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: ComparisonRoute,
  searchParams: URLSearchParams,
  services: EvaluationComparisonHttpServices,
): Promise<void> {
  const scope = requireControlPlaneScope();

  if (route.kind === "comparisons") {
    if (method === "GET") {
      await handleListComparisons(response, searchParams, services.comparisons);
      return;
    }
    if (method === "POST") {
      const parsed = createEvaluationComparisonRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }
      const created = await services.comparisons.createComparison.execute(
        scope,
        parsed.data,
      );
      sendJson(response, 201, toEvaluationComparisonResource(created));
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

  if (route.kind === "comparison") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }
    const comparison = await services.comparisons.getComparison.execute(
      scope,
      route.comparisonId,
    );
    sendJson(response, 200, toEvaluationComparisonResource(comparison));
    return;
  }

  if (route.kind === "pairwise-results") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }
    const results = await services.comparisons.listPairwiseResults.execute(
      scope,
      route.comparisonId,
    );
    sendJson(response, 200, toPairwiseResultListResource(results));
    return;
  }

  if (route.kind === "assessment") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }
    const assessment = await services.comparisons.getAssessment.execute(
      scope,
      route.comparisonId,
    );
    sendJson(
      response,
      200,
      evaluationComparisonAssessmentResourceSchema.parse({
        ...assessment,
        completedAt: assessment.completedAt?.toISOString(),
      }),
    );
    return;
  }

  if (route.kind === "human-reviews") {
    if (method === "GET") {
      const reviews = await services.comparisons.listHumanReviews.execute(
        scope,
        route.comparisonId,
      );
      sendJson(
        response,
        200,
        evaluationComparisonHumanReviewListResourceSchema.parse({
          reviews: reviews.map(toHumanReviewResource),
        }),
      );
      return;
    }
    if (method === "POST") {
      const principal = scope.principal;
      if (!isHumanSessionRequestPrincipal(principal)) {
        throw new HumanPrincipalRequiredError();
      }
      const parsed =
        submitEvaluationComparisonHumanReviewRequestSchema.safeParse(
          await readJsonBody(request),
        );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }
      const revision = await services.comparisons.submitHumanReview.execute(
        scope,
        route.comparisonId,
        {
          reviewerUserId: principal.userId,
          evaluationCaseId: parsed.data.evaluationCaseId,
          decision: parsed.data.decision,
          rationale: parsed.data.rationale,
          supersedesRevisionId: parsed.data.supersedesRevisionId as
            EvaluationComparisonHumanReviewRevisionId | undefined,
        },
      );

      if (
        services.securityAuditEvents !== undefined &&
        services.clock !== undefined &&
        services.ids !== undefined
      ) {
        const actor = controlPlaneAuditActor(scope);
        if (actor.actorUserId !== undefined) {
          await appendSecurityAuditEvent({
            repository: services.securityAuditEvents,
            event: buildEvaluationComparisonHumanReviewSubmittedAuditEvent({
              id: services.ids.createId() as SecurityAuditEventId,
              occurredAt: services.clock.now(),
              workspaceId: actor.workspaceId,
              actorUserId: actor.actorUserId,
              comparisonId: route.comparisonId,
              evaluationCaseId: parsed.data.evaluationCaseId,
              revisionId: revision.id,
              decision: parsed.data.decision,
            }),
          });
        }
      }

      sendJson(
        response,
        201,
        evaluationComparisonHumanReviewResourceSchema.parse(
          toHumanReviewResource(revision),
        ),
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

  if (route.kind === "calibration") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }
    const calibration = await services.comparisons.getCalibration.execute(
      scope,
      route.comparisonId,
    );
    sendJson(
      response,
      200,
      evaluationComparisonCalibrationResourceSchema.parse(calibration),
    );
    return;
  }
}

async function handleListComparisons(
  response: ServerResponse,
  searchParams: URLSearchParams,
  comparisons: EvaluationComparisonApplication,
): Promise<void> {
  const scope = requireControlPlaneScope();
  const parsed = listEvaluationComparisonsQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  let limit = DEFAULT_EVALUATION_COMPARISON_LIST_LIMIT;
  if (parsed.data.limit !== undefined) {
    limit = Number(parsed.data.limit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_EVALUATION_COMPARISON_LIST_LIMIT
    ) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
  }

  let cursor:
    | { readonly createdAt: Date; readonly id: EvaluationComparisonId }
    | undefined;
  if (parsed.data.cursor !== undefined) {
    const decoded = decodeEvaluationComparisonListCursor(parsed.data.cursor);
    if (decoded === null) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
    cursor = {
      createdAt: new Date(decoded.createdAt),
      id: decoded.id as EvaluationComparisonId,
    };
  }

  const page = await comparisons.listComparisons.execute(scope, {
    limit,
    cursor,
    status: parsed.data.status,
    evaluationSuiteVersionId: parsed.data.evaluationSuiteVersionId,
    baselineEvaluationRunId: parsed.data.baselineEvaluationRunId,
    candidateEvaluationRunId: parsed.data.candidateEvaluationRunId,
  });

  sendJson(
    response,
    200,
    evaluationComparisonListResourceSchema.parse({
      comparisons: page.comparisons.map(toEvaluationComparisonResource),
      nextCursor:
        page.nextCursor === undefined
          ? undefined
          : encodeEvaluationComparisonListCursor({
              createdAt: page.nextCursor.createdAt.toISOString(),
              id: page.nextCursor.id,
            }),
    }),
  );
}

function toEvaluationComparisonResource(comparison: EvaluationComparison) {
  return evaluationComparisonResourceSchema.parse({
    id: comparison.id,
    workspaceId: comparison.workspaceId,
    baselineEvaluationRunId: comparison.baselineEvaluationRunId,
    candidateEvaluationRunId: comparison.candidateEvaluationRunId,
    evaluationSuiteVersionId: comparison.evaluationSuiteVersionId,
    status: comparison.status,
    policy: comparison.policySnapshot,
    pairwise: comparison.pairwiseConfig,
    deterministicSummary: comparison.deterministicSummary,
    pairwiseSummary: comparison.pairwiseSummary,
    regressionAssessment: comparison.regressionAssessment,
    promotion: comparison.promotion,
    costSummary: comparison.costSummary,
    createdAt: comparison.createdAt.toISOString(),
    updatedAt: comparison.updatedAt.toISOString(),
    completedAt: comparison.completedAt?.toISOString(),
  });
}

function toPairwiseResultListResource(
  tasks: readonly EvaluationComparisonPairwiseTask[],
) {
  return evaluationComparisonPairwiseResultListResourceSchema.parse({
    results: tasks.map((task) => {
      const verdict = task.terminalResult?.verdict ?? {};
      return {
        id: task.id,
        evaluationCaseId: task.evaluationCaseId,
        judgmentPosition: task.judgmentPosition,
        status: task.status,
        canonicalPreference:
          typeof verdict.canonicalPreference === "string"
            ? verdict.canonicalPreference
            : undefined,
        reason: typeof verdict.reason === "string" ? verdict.reason : undefined,
        errorCode: task.errorCode,
        modelProfileVersionId: task.snapshot.modelProfileVersionId,
        createdAt: task.createdAt.toISOString(),
        completedAt: task.completedAt?.toISOString(),
      };
    }),
  });
}

function toHumanReviewResource(
  revision: EvaluationComparisonHumanReviewRevision,
) {
  return {
    id: revision.id,
    comparisonId: revision.comparisonId,
    evaluationCaseId: revision.evaluationCaseId,
    reviewerUserId: revision.reviewerUserId,
    decision: revision.decision,
    rationale: revision.rationale,
    evidenceReference: revision.evidenceReference,
    supersedesRevisionId: revision.supersedesRevisionId,
    createdAt: revision.createdAt.toISOString(),
  };
}

export const V1_EVALUATION_COMPARISON_HTTP_ROUTES = [
  { method: "POST", path: "/v1/evaluation-comparisons" },
  { method: "GET", path: "/v1/evaluation-comparisons" },
  { method: "GET", path: "/v1/evaluation-comparisons/:comparisonId" },
  {
    method: "GET",
    path: "/v1/evaluation-comparisons/:comparisonId/pairwise-results",
  },
  {
    method: "GET",
    path: "/v1/evaluation-comparisons/:comparisonId/assessment",
  },
  {
    method: "POST",
    path: "/v1/evaluation-comparisons/:comparisonId/human-reviews",
  },
  {
    method: "GET",
    path: "/v1/evaluation-comparisons/:comparisonId/human-reviews",
  },
  {
    method: "GET",
    path: "/v1/evaluation-comparisons/:comparisonId/calibration",
  },
] as const;
