import type { EvaluationComparisonId } from "@osva-ai/contracts";
import {
  createEvaluationComparisonRequestSchema,
  evaluationComparisonAssessmentResourceSchema,
  evaluationComparisonCalibrationResourceSchema,
  evaluationComparisonHumanReviewListResourceSchema,
  evaluationComparisonListResourceSchema,
  evaluationComparisonPairwiseResultListResourceSchema,
  evaluationComparisonResourceSchema,
  listEvaluationComparisonsQuerySchema,
} from "@osva-ai/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateEvaluationComparisonRequest = z.infer<
  typeof createEvaluationComparisonRequestSchema
>;
type EvaluationComparisonResource = z.infer<
  typeof evaluationComparisonResourceSchema
>;
type EvaluationComparisonListResource = z.infer<
  typeof evaluationComparisonListResourceSchema
>;
type EvaluationComparisonPairwiseResultListResource = z.infer<
  typeof evaluationComparisonPairwiseResultListResourceSchema
>;
type EvaluationComparisonAssessmentResource = z.infer<
  typeof evaluationComparisonAssessmentResourceSchema
>;
type EvaluationComparisonCalibrationResource = z.infer<
  typeof evaluationComparisonCalibrationResourceSchema
>;
type EvaluationComparisonHumanReviewListResource = z.infer<
  typeof evaluationComparisonHumanReviewListResourceSchema
>;

export interface ListEvaluationComparisonsParams {
  readonly limit?: number;
  readonly cursor?: string;
  readonly status?: string;
  readonly evaluationSuiteVersionId?: string;
  readonly baselineEvaluationRunId?: string;
  readonly candidateEvaluationRunId?: string;
}

export class EvaluationComparisonsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  create(
    input: CreateEvaluationComparisonRequest,
  ): Promise<EvaluationComparisonResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/evaluation-comparisons",
      body: createEvaluationComparisonRequestSchema.parse(input),
    });
  }

  list(
    params: ListEvaluationComparisonsParams = {},
  ): Promise<EvaluationComparisonListResource> {
    const query = listEvaluationComparisonsQuerySchema.parse({
      ...params,
      limit: params.limit === undefined ? undefined : String(params.limit),
    });
    return this.client.request({
      method: "GET",
      path: "/v1/evaluation-comparisons",
      query: {
        limit: query.limit,
        cursor: query.cursor,
        status: query.status,
        evaluationSuiteVersionId: query.evaluationSuiteVersionId,
        baselineEvaluationRunId: query.baselineEvaluationRunId,
        candidateEvaluationRunId: query.candidateEvaluationRunId,
      },
    });
  }

  get(
    comparisonId: EvaluationComparisonId,
  ): Promise<EvaluationComparisonResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-comparisons/${encodeURIComponent(comparisonId)}`,
    });
  }

  listPairwiseResults(
    comparisonId: EvaluationComparisonId,
  ): Promise<EvaluationComparisonPairwiseResultListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-comparisons/${encodeURIComponent(comparisonId)}/pairwise-results`,
    });
  }

  getAssessment(
    comparisonId: EvaluationComparisonId,
  ): Promise<EvaluationComparisonAssessmentResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-comparisons/${encodeURIComponent(comparisonId)}/assessment`,
    });
  }

  listHumanReviews(
    comparisonId: EvaluationComparisonId,
  ): Promise<EvaluationComparisonHumanReviewListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-comparisons/${encodeURIComponent(comparisonId)}/human-reviews`,
    });
  }

  getCalibration(
    comparisonId: EvaluationComparisonId,
  ): Promise<EvaluationComparisonCalibrationResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-comparisons/${encodeURIComponent(comparisonId)}/calibration`,
    });
  }
}
