import type {
  EvaluationCaseId,
  EvaluationRunId,
  EvaluationRunState,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva/contracts";

import type { EvaluationCase } from "../evaluation-case.js";
import type { EvaluationCaseResult } from "../evaluation-case-result.js";
import type { EvaluationRun } from "../evaluation-run.js";
import type { EvaluationSuite } from "../evaluation-suite.js";
import type { EvaluationSuiteVersion } from "../evaluation-suite-version.js";

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
}
