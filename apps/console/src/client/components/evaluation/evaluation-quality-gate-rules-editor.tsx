import type { EvaluationQualityGateMetric } from "@osva-ai/contracts";

import {
  availableQualityGateMetrics,
  QUALITY_GATE_METRIC_DEFINITIONS,
  qualityGateMetricDefinition,
  type QualityGateDraftValidationIssue,
  type QualityGateRuleDraft,
} from "../../lib/evaluation-quality-gate-config";

export interface EvaluationQualityGateRulesEditorProps {
  readonly enabled: boolean;
  readonly rules: readonly QualityGateRuleDraft[];
  readonly issues: readonly QualityGateDraftValidationIssue[];
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onRulesChange: (rules: readonly QualityGateRuleDraft[]) => void;
}

export function EvaluationQualityGateRulesEditor({
  enabled,
  rules,
  issues,
  onEnabledChange,
  onRulesChange,
}: EvaluationQualityGateRulesEditorProps) {
  const rulesLevelMessage = issues.find(
    (issue) => issue.field === "rules",
  )?.message;

  function issueFor(localId: string, field: "metric" | "threshold") {
    return issues.find(
      (issue) => issue.localId === localId && issue.field === field,
    )?.message;
  }

  function addRule() {
    const nextMetric = availableQualityGateMetrics(rules, "new")[0];
    if (nextMetric === undefined) {
      return;
    }
    onRulesChange([
      ...rules,
      {
        localId: `rule-${String(Date.now())}`,
        metric: nextMetric,
        thresholdDisplay: "",
      },
    ]);
  }

  function updateRule(localId: string, patch: Partial<QualityGateRuleDraft>) {
    onRulesChange(
      rules.map((rule) =>
        rule.localId === localId ? { ...rule, ...patch } : rule,
      ),
    );
  }

  function removeRule(localId: string) {
    onRulesChange(rules.filter((rule) => rule.localId !== localId));
  }

  return (
    <section
      className="stack"
      style={{ gap: 12 }}
      aria-labelledby="gate-heading"
    >
      <div className="field">
        <label className="checkbox-row" htmlFor="quality-gates-enabled">
          <input
            id="quality-gates-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              onEnabledChange(event.target.checked);
            }}
          />
          <span id="gate-heading">Enable quality gates</span>
        </label>
        <p className="muted">
          Optional thresholds on aggregate evaluation metrics. Gates do not
          change run lifecycle status.
        </p>
      </div>

      {enabled ? (
        <>
          {rules.map((rule) => {
            const definition = qualityGateMetricDefinition(rule.metric);
            const metricError = issueFor(rule.localId, "metric");
            const thresholdError = issueFor(rule.localId, "threshold");
            const metrics = availableQualityGateMetrics(rules, rule.localId);
            const selectableMetrics = metrics.includes(rule.metric)
              ? metrics
              : [rule.metric, ...metrics];

            return (
              <div key={rule.localId} className="panel" style={{ padding: 12 }}>
                <div className="stack" style={{ gap: 8 }}>
                  <div className="field">
                    <label htmlFor={`gate-metric-${rule.localId}`}>
                      Metric
                    </label>
                    <select
                      id={`gate-metric-${rule.localId}`}
                      value={rule.metric}
                      onChange={(event) => {
                        const metric = event.target
                          .value as EvaluationQualityGateMetric;
                        updateRule(rule.localId, {
                          metric,
                          thresholdDisplay: "",
                        });
                      }}
                    >
                      {selectableMetrics.map((metric) => {
                        const meta = QUALITY_GATE_METRIC_DEFINITIONS.find(
                          (entry) => entry.metric === metric,
                        );
                        return (
                          <option key={metric} value={metric}>
                            {meta?.label ?? metric}
                          </option>
                        );
                      })}
                    </select>
                    <p className="muted">{definition.helperText}</p>
                    {metricError !== undefined ? (
                      <p className="field-error">{metricError}</p>
                    ) : null}
                  </div>

                  <div className="field">
                    <label htmlFor={`gate-threshold-${rule.localId}`}>
                      {definition.operator === "MIN" ? "Minimum" : "Maximum"}{" "}
                      threshold
                      {definition.displayUnit === "percent"
                        ? " (%)"
                        : definition.displayUnit === "usd"
                          ? " (USD)"
                          : definition.displayUnit === "milliseconds"
                            ? " (ms)"
                            : ""}
                    </label>
                    <input
                      id={`gate-threshold-${rule.localId}`}
                      type="text"
                      inputMode={
                        definition.displayUnit === "percent" ||
                        definition.displayUnit === "usd"
                          ? "decimal"
                          : "numeric"
                      }
                      value={rule.thresholdDisplay}
                      onChange={(event) => {
                        updateRule(rule.localId, {
                          thresholdDisplay: event.target.value,
                        });
                      }}
                      aria-invalid={thresholdError !== undefined}
                    />
                    {thresholdError !== undefined ? (
                      <p className="field-error">{thresholdError}</p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      removeRule(rule.localId);
                    }}
                  >
                    Remove rule
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            className="button button-secondary"
            disabled={availableQualityGateMetrics(rules, "new").length === 0}
            onClick={addRule}
          >
            Add rule
          </button>

          {rulesLevelMessage !== undefined ? (
            <p className="field-error" role="alert">
              {rulesLevelMessage}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
