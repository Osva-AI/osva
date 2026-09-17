import type {
  EvaluationRunId,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
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
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateEvaluationSuiteRequest = z.infer<
  typeof createEvaluationSuiteRequestSchema
>;
type EvaluationSuiteListResource = z.infer<
  typeof evaluationSuiteListResourceSchema
>;
type EvaluationSuiteResource = z.infer<typeof evaluationSuiteResourceSchema>;
type CreateEvaluationSuiteVersionRequest = z.infer<
  typeof createEvaluationSuiteVersionRequestSchema
>;
type EvaluationSuiteVersionListResource = z.infer<
  typeof evaluationSuiteVersionListResourceSchema
>;
type EvaluationSuiteVersionResource = z.infer<
  typeof evaluationSuiteVersionResourceSchema
>;
type CreateEvaluationRunRequest = z.infer<
  typeof createEvaluationRunRequestSchema
>;
type EvaluationRunDetailResource = z.infer<
  typeof evaluationRunDetailResourceSchema
>;
type EvaluationCaseResultListResource = z.infer<
  typeof evaluationCaseResultListResourceSchema
>;

export class EvaluationSuitesResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<EvaluationSuiteListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/evaluation-suites",
    });
  }

  get(suiteId: EvaluationSuiteId): Promise<EvaluationSuiteResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-suites/${encodeURIComponent(suiteId)}`,
    });
  }

  create(
    input: CreateEvaluationSuiteRequest,
  ): Promise<EvaluationSuiteResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/evaluation-suites",
      body: input,
    });
  }

  listVersions(
    suiteId: EvaluationSuiteId,
  ): Promise<EvaluationSuiteVersionListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-suites/${encodeURIComponent(suiteId)}/versions`,
    });
  }

  createVersion(
    suiteId: EvaluationSuiteId,
    input: CreateEvaluationSuiteVersionRequest,
  ): Promise<EvaluationSuiteVersionResource> {
    return this.client.request({
      method: "POST",
      path: `/v1/evaluation-suites/${encodeURIComponent(suiteId)}/versions`,
      body: input,
    });
  }

  getVersion(
    suiteId: EvaluationSuiteId,
    versionId: EvaluationSuiteVersionId,
  ): Promise<EvaluationSuiteVersionResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-suites/${encodeURIComponent(suiteId)}/versions/${encodeURIComponent(versionId)}`,
    });
  }
}

export class EvaluationRunsResource {
  constructor(
    private readonly client: OsvaHttpClient,
    private readonly workspaceId: string,
  ) {}

  create(
    input: Omit<CreateEvaluationRunRequest, "workspaceId">,
  ): Promise<EvaluationRunDetailResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/evaluation-runs",
      body: { ...input, workspaceId: this.workspaceId },
    });
  }

  get(evaluationRunId: EvaluationRunId): Promise<EvaluationRunDetailResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-runs/${encodeURIComponent(evaluationRunId)}`,
    });
  }

  listCaseResults(
    evaluationRunId: EvaluationRunId,
  ): Promise<EvaluationCaseResultListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/evaluation-runs/${encodeURIComponent(evaluationRunId)}/case-results`,
    });
  }
}
