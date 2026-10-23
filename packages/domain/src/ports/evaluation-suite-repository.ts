import type {
  AgentVersionId,
  EvaluationCaseId,
  EvaluationRunId,
  EvaluationRunState,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { EvaluationCase } from "../evaluation-case.js";
import type { EvaluationCaseResult } from "../evaluation-case-result.js";
import type { EvaluationRun } from "../evaluation-run.js";
import type { EvaluationRunGateAssessment } from "../evaluation-run-gate-assessment.js";
import type { EvaluationSuite } from "../evaluation-suite.js";
import type { EvaluationSuiteVersion } from "../evaluation-suite-version.js";

export const DEFAULT_EVALUATION_RUN_LIST_LIMIT = 50;
export const MAX_EVALUATION_RUN_LIST_LIMIT = 100;

export interface EvaluationRunListCursor {
  readonly createdAt: Date;
  readonly id: EvaluationRunId;
}

export interface ListEvaluationRunsQuery {
  readonly workspaceId: WorkspaceId;
  readonly limit: number;
  readonly cursor?: EvaluationRunListCursor;
  readonly evaluationSuiteId?: EvaluationSuiteId;
  readonly evaluationSuiteVersionId?: EvaluationSuiteVersionId;
  readonly agentVersionId?: AgentVersionId;
  readonly status?: EvaluationRunState;
}

export interface ListEvaluationRunsResult {
  readonly evaluationRuns: readonly EvaluationRun[];
  readonly nextCursor?: EvaluationRunListCursor;
}

export interface EvaluationSuiteRepository {
  saveSuite(suite: EvaluationSuite): Promise<void>;
  findSuiteById(id: EvaluationSuiteId): Promise<EvaluationSuite | null>;
  findSuiteByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: EvaluationSuiteId,
  ): Promise<EvaluationSuite | null>;
  listSuitesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly EvaluationSuite[]>;
  saveSuiteVersion(version: EvaluationSuiteVersion): Promise<void>;
  findSuiteVersionById(
    id: EvaluationSuiteVersionId,
  ): Promise<EvaluationSuiteVersion | null>;
  listSuiteVersionsBySuite(
    evaluationSuiteId: EvaluationSuiteId,
  ): Promise<readonly EvaluationSuiteVersion[]>;
  saveEvaluationRun(evaluationRun: EvaluationRun): Promise<void>;
  findEvaluationRunById(id: EvaluationRunId): Promise<EvaluationRun | null>;
  findEvaluationRunByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: EvaluationRunId,
  ): Promise<EvaluationRun | null>;
  listEvaluationRuns(
    query: ListEvaluationRunsQuery,
  ): Promise<ListEvaluationRunsResult>;
  transitionEvaluationRun(
    expectedStatus: EvaluationRunState,
    next: EvaluationRun,
  ): Promise<EvaluationRun>;
  saveCaseResult(result: EvaluationCaseResult): Promise<void>;
  findCaseResultByRunAndCase(
    evaluationRunId: EvaluationRunId,
    evaluationCaseId: EvaluationCaseId,
  ): Promise<EvaluationCaseResult | null>;
  listCaseResultsByEvaluationRun(
    evaluationRunId: EvaluationRunId,
  ): Promise<readonly EvaluationCaseResult[]>;
  findCaseById(id: EvaluationCaseId): Promise<EvaluationCase | null>;
  saveGateAssessment(assessment: EvaluationRunGateAssessment): Promise<void>;
  findGateAssessmentByEvaluationRunId(
    evaluationRunId: EvaluationRunId,
  ): Promise<EvaluationRunGateAssessment | null>;
  findGateAssessmentByWorkspaceAndEvaluationRunId(
    workspaceId: WorkspaceId,
    evaluationRunId: EvaluationRunId,
  ): Promise<EvaluationRunGateAssessment | null>;
}
