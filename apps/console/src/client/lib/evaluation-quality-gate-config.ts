import type {
  EvaluationQualityGateMetric,
  EvaluationQualityGatePolicyV1,
  EvaluationQualityGateRuleV1,
} from "@osva-ai/contracts";
import {
  EVALUATION_QUALITY_GATE_MAX_METRICS,
  EVALUATION_QUALITY_GATE_METRICS,
  EVALUATION_QUALITY_GATE_MIN_METRICS,
  EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
} from "@osva-ai/contracts";
import { evaluationQualityGatePolicySchema } from "@osva-ai/contracts/schemas";

export type QualityGateMetricDisplayUnit =
  "percent" | "integer" | "usd" | "milliseconds";

export interface QualityGateMetricDefinition {
  readonly metric: EvaluationQualityGateMetric;
  readonly label: string;
  readonly operator: "MIN" | "MAX";
  readonly displayUnit: QualityGateMetricDisplayUnit;
  readonly helperText: string;
}

export const QUALITY_GATE_METRIC_DEFINITIONS: readonly QualityGateMetricDefinition[] =
  [
    {
      metric: "PASS_RATE",
      label: "Pass rate",
      operator: "MIN",
      displayUnit: "percent",
      helperText: "Minimum share of cases that must pass (0–100%).",
    },
    {
      metric: "QUALITY_SCORE",
      label: "Quality score",
      operator: "MIN",
      displayUnit: "percent",
      helperText:
        "Minimum average normalized score across scored cases (0–100%).",
    },
    {
      metric: "COMPLETION_COVERAGE",
      label: "Completion coverage",
      operator: "MIN",
      displayUnit: "percent",
      helperText: "Minimum share of cases that must finish execution (0–100%).",
    },
    {
      metric: "ERROR_COUNT",
      label: "Error count",
      operator: "MAX",
      displayUnit: "integer",
      helperText: "Maximum allowed ERROR outcomes (non‑negative integer).",
    },
    {
      metric: "ESTIMATED_COST_USD_MICROS",
      label: "Estimated priced cost",
      operator: "MAX",
      displayUnit: "usd",
      helperText:
        "Maximum priced model cost from measured usage (USD). Not provider billing.",
    },
    {
      metric: "DURATION_MS",
      label: "Duration",
      operator: "MAX",
      displayUnit: "milliseconds",
      helperText: "Maximum evaluation run duration in milliseconds.",
    },
  ];

export function qualityGateMetricDefinition(
  metric: EvaluationQualityGateMetric,
): QualityGateMetricDefinition {
  const found = QUALITY_GATE_METRIC_DEFINITIONS.find(
    (entry) => entry.metric === metric,
  );
  if (found === undefined) {
    throw new Error(`Unsupported quality gate metric '${metric}'.`);
  }
  return found;
}

export interface QualityGateRuleDraft {
  readonly localId: string;
  readonly metric: EvaluationQualityGateMetric;
  readonly thresholdDisplay: string;
}

export interface QualityGateDraftValidationIssue {
  readonly localId?: string;
  readonly field: "metric" | "threshold" | "rules";
  readonly message: string;
}

export function parsePercentToUnitRate(display: string): number | undefined {
  const trimmed = display.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return undefined;
  }
  return parsed / 100;
}

export function parseNonNegativeInteger(display: string): number | undefined {
  const trimmed = display.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

export function parseUsdToCostMicros(display: string): number | undefined {
  const trimmed = display.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  const micros = Math.round(parsed * 1_000_000);
  if (!Number.isSafeInteger(micros)) {
    return undefined;
  }
  return micros;
}

export function parseDisplayThresholdToCanonical(
  metric: EvaluationQualityGateMetric,
  thresholdDisplay: string,
): number | undefined {
  const definition = qualityGateMetricDefinition(metric);
  switch (definition.displayUnit) {
    case "percent":
      return parsePercentToUnitRate(thresholdDisplay);
    case "integer":
      return parseNonNegativeInteger(thresholdDisplay);
    case "usd":
      return parseUsdToCostMicros(thresholdDisplay);
    case "milliseconds":
      return parseNonNegativeInteger(thresholdDisplay);
  }
}

export function formatCanonicalThresholdForDisplay(
  metric: EvaluationQualityGateMetric,
  threshold: number,
): string {
  const definition = qualityGateMetricDefinition(metric);
  switch (definition.displayUnit) {
    case "percent":
      return String(Math.round(threshold * 10_000) / 100);
    case "usd":
      return String(threshold / 1_000_000);
    case "integer":
    case "milliseconds":
      return String(threshold);
  }
}

function buildRuleFromDraft(
  draft: QualityGateRuleDraft,
): EvaluationQualityGateRuleV1 | undefined {
  const threshold = parseDisplayThresholdToCanonical(
    draft.metric,
    draft.thresholdDisplay,
  );
  if (threshold === undefined) {
    return undefined;
  }
  const definition = qualityGateMetricDefinition(draft.metric);
  if (definition.operator === "MIN") {
    return {
      metric:
        draft.metric as (typeof EVALUATION_QUALITY_GATE_MIN_METRICS)[number],
      operator: "MIN",
      threshold,
    };
  }
  return {
    metric:
      draft.metric as (typeof EVALUATION_QUALITY_GATE_MAX_METRICS)[number],
    operator: "MAX",
    threshold,
  };
}

export function validateQualityGateRuleDrafts(
  enabled: boolean,
  rules: readonly QualityGateRuleDraft[],
): readonly QualityGateDraftValidationIssue[] {
  if (!enabled) {
    return [];
  }
  if (rules.length === 0) {
    return [
      {
        field: "rules",
        message: "Add at least one quality gate rule or disable gates.",
      },
    ];
  }

  const issues: QualityGateDraftValidationIssue[] = [];
  const seen = new Set<EvaluationQualityGateMetric>();

  for (const draft of rules) {
    if (!EVALUATION_QUALITY_GATE_METRICS.includes(draft.metric)) {
      issues.push({
        localId: draft.localId,
        field: "metric",
        message: "Unsupported metric.",
      });
      continue;
    }
    if (seen.has(draft.metric)) {
      issues.push({
        localId: draft.localId,
        field: "metric",
        message: "Each metric can only appear once.",
      });
    }
    seen.add(draft.metric);

    const threshold = parseDisplayThresholdToCanonical(
      draft.metric,
      draft.thresholdDisplay,
    );
    if (threshold === undefined) {
      issues.push({
        localId: draft.localId,
        field: "threshold",
        message: thresholdValidationMessage(draft.metric),
      });
    }
  }

  if (issues.length > 0) {
    return issues;
  }

  const policy = buildQualityGatePolicyFromDrafts(rules);
  if (policy === undefined) {
    return [
      {
        field: "rules",
        message: "Quality gate policy is invalid.",
      },
    ];
  }

  const parsed = evaluationQualityGatePolicySchema.safeParse(policy);
  if (!parsed.success) {
    return [
      {
        field: "rules",
        message: "Quality gate policy does not match server validation.",
      },
    ];
  }

  return [];
}

function thresholdValidationMessage(
  metric: EvaluationQualityGateMetric,
): string {
  const definition = qualityGateMetricDefinition(metric);
  switch (definition.displayUnit) {
    case "percent":
      return "Enter a percentage from 0 to 100.";
    case "usd":
      return "Enter a non‑negative USD amount.";
    case "integer":
      return "Enter a non‑negative whole number.";
    case "milliseconds":
      return "Enter a non‑negative duration in milliseconds.";
  }
}

export function buildQualityGatePolicyFromDrafts(
  rules: readonly QualityGateRuleDraft[],
): EvaluationQualityGatePolicyV1 | undefined {
  if (rules.length === 0) {
    return undefined;
  }
  const built: EvaluationQualityGateRuleV1[] = [];
  for (const draft of rules) {
    const rule = buildRuleFromDraft(draft);
    if (rule === undefined) {
      return undefined;
    }
    built.push(rule);
  }
  return {
    schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
    rules: built,
  };
}

export function availableQualityGateMetrics(
  rules: readonly QualityGateRuleDraft[],
  localId: string,
): readonly EvaluationQualityGateMetric[] {
  const used = new Set(
    rules.filter((rule) => rule.localId !== localId).map((rule) => rule.metric),
  );
  return EVALUATION_QUALITY_GATE_METRICS.filter((metric) => !used.has(metric));
}
