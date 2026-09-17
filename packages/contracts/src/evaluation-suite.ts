import type {
  AgentVersionId,
  EvaluationCaseId,
  EvaluationCaseResultId,
  EvaluationRunId,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  RunId,
  WorkflowVersionId,
  WorkspaceId,
} from "./ids.js";
import type { JsonValue } from "./json-value.js";
import type { EvaluatorConfig } from "./evaluation.js";

export const EVALUATION_RUN_STATES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type EvaluationRunState = (typeof EVALUATION_RUN_STATES)[number];

export const EVALUATION_RUN_TARGET_TYPES = [
  "AGENT_VERSION",
  "WORKFLOW_VERSION",
] as const;

export type EvaluationRunTargetType =
  (typeof EVALUATION_RUN_TARGET_TYPES)[number];

export const EVALUATION_CASE_OUTCOMES = ["PASS", "FAIL", "ERROR"] as const;

export type EvaluationCaseOutcome = (typeof EVALUATION_CASE_OUTCOMES)[number];

export interface EvaluationSuiteResourceV1 {
  readonly id: EvaluationSuiteId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvaluationSuiteListResourceV1 {
  readonly items: readonly EvaluationSuiteResourceV1[];
}

export interface CreateEvaluationSuiteRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface EvaluationCaseDefinitionV1 {
  readonly key: string;
  readonly name?: string;
  readonly input: JsonValue;
  readonly expected?: JsonValue;
  readonly evaluator: EvaluatorConfig;
}

export interface EvaluationCaseResourceV1 {
  readonly id: EvaluationCaseId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly key: string;
  readonly name?: string;
  readonly input: JsonValue;
  readonly expected?: JsonValue;
  readonly evaluator: EvaluatorConfig;
  readonly createdAt: string;
}

export interface EvaluationSuiteVersionResourceV1 {
  readonly id: EvaluationSuiteVersionId;
  readonly evaluationSuiteId: EvaluationSuiteId;
  readonly version: number;
  readonly cases: readonly EvaluationCaseResourceV1[];
  readonly createdAt: string;
}

export interface EvaluationSuiteVersionListResourceV1 {
  readonly items: readonly EvaluationSuiteVersionResourceV1[];
}

export interface CreateEvaluationSuiteVersionRequestV1 {
  readonly cases: readonly EvaluationCaseDefinitionV1[];
}

export interface CreateEvaluationRunRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly targetType: EvaluationRunTargetType;
  readonly targetVersionId: AgentVersionId | WorkflowVersionId;
}

export interface EvaluationRunResourceV1 {
  readonly id: EvaluationRunId;
  readonly workspaceId: WorkspaceId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly targetType: EvaluationRunTargetType;
  readonly targetVersionId: string;
  readonly status: EvaluationRunState;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
}

export interface EvaluationRunSummaryV1 {
  readonly totalCases: number;
  readonly pendingCases: number;
  readonly runningCases: number;
  readonly completedCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly errorCases: number;
  readonly passRate: number;
  readonly durationMs?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly pricedCostUsdMicros: number;
  readonly unpricedModelCalls: number;
}

export interface EvaluationRunDetailResourceV1 extends EvaluationRunResourceV1 {
  readonly summary: EvaluationRunSummaryV1;
}

export interface EvaluationCaseResultResourceV1 {
  readonly id: EvaluationCaseResultId;
  readonly evaluationRunId: EvaluationRunId;
  readonly evaluationCaseId: EvaluationCaseId;
  readonly runId: RunId;
  readonly outcome: EvaluationCaseOutcome;
  readonly evaluatorResults: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface EvaluationCaseResultListResourceV1 {
  readonly items: readonly EvaluationCaseResultResourceV1[];
}
