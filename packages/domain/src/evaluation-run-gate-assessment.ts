import type {
  EvaluationQualityGateAssessmentV1,
  EvaluationQualityGatePolicyV1,
  EvaluationRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { DomainInvariantError } from "./errors.js";
import { deepFreeze } from "./internals.js";

export interface EvaluationRunGateAssessmentProps {
  readonly evaluationRunId: EvaluationRunId;
  readonly workspaceId: WorkspaceId;
  readonly policySnapshot: EvaluationQualityGatePolicyV1;
  readonly assessment: EvaluationQualityGateAssessmentV1;
}

export class EvaluationRunGateAssessment {
  readonly evaluationRunId: EvaluationRunId;
  readonly workspaceId: WorkspaceId;
  readonly policySnapshot: EvaluationQualityGatePolicyV1;
  readonly assessment: EvaluationQualityGateAssessmentV1;

  private constructor(props: EvaluationRunGateAssessmentProps) {
    this.evaluationRunId = props.evaluationRunId;
    this.workspaceId = props.workspaceId;
    this.policySnapshot = props.policySnapshot;
    this.assessment = props.assessment;
  }

  static create(
    props: EvaluationRunGateAssessmentProps,
  ): EvaluationRunGateAssessment {
    if (!props.evaluationRunId) {
      throw new DomainInvariantError(
        "EvaluationRunGateAssessment.evaluationRunId is required.",
      );
    }
    if (!props.workspaceId) {
      throw new DomainInvariantError(
        "EvaluationRunGateAssessment.workspaceId is required.",
      );
    }

    return Object.freeze(
      new EvaluationRunGateAssessment({
        evaluationRunId: props.evaluationRunId,
        workspaceId: props.workspaceId,
        policySnapshot: deepFreeze(props.policySnapshot),
        assessment: deepFreeze(props.assessment),
      }),
    );
  }
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }
  return value;
}

function canonicalPolicyJson(policy: EvaluationQualityGatePolicyV1): string {
  const rules = [...policy.rules].sort((left, right) =>
    left.metric.localeCompare(right.metric),
  );
  return JSON.stringify(normalizeJson({ ...policy, rules }));
}

function canonicalAssessmentJson(
  assessment: EvaluationQualityGateAssessmentV1,
): string {
  const ruleResults = [...assessment.ruleResults].sort((left, right) =>
    left.metric.localeCompare(right.metric),
  );
  return JSON.stringify(normalizeJson({ ...assessment, ruleResults }));
}

export function isSameEvaluationRunGateAssessment(
  left: EvaluationRunGateAssessment,
  right: EvaluationRunGateAssessment,
): boolean {
  return (
    left.evaluationRunId === right.evaluationRunId &&
    left.workspaceId === right.workspaceId &&
    canonicalPolicyJson(left.policySnapshot) ===
      canonicalPolicyJson(right.policySnapshot) &&
    canonicalAssessmentJson(left.assessment) ===
      canonicalAssessmentJson(right.assessment)
  );
}
