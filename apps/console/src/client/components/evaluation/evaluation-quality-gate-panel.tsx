import type { EvaluationRunDetailResource } from "../../hooks/use-evaluations";
import {
  ESTIMATED_COST_DISCLAIMER,
  formatConfiguredGateThreshold,
  formatGateOperatorLabel,
  formatObservedGateValue,
  parseQualityGateRuleResults,
  qualityGateReasonLabel,
  qualityGateVerdictCategory,
  qualityGateVerdictLabel,
} from "../../lib/evaluation-quality-gate-display";
import { isEvaluationRunLive } from "../../lib/evaluation-run-status";
import { StatusChip } from "../status/status-chip";

export interface EvaluationQualityGatePanelProps {
  readonly evaluationRun: EvaluationRunDetailResource;
}

export function EvaluationQualityGatePanel({
  evaluationRun,
}: EvaluationQualityGatePanelProps) {
  const qualityGate = evaluationRun.qualityGate;
  if (qualityGate === undefined) {
    return (
      <section className="panel">
        <h2 className="panel-title">Quality gate</h2>
        <p className="muted">No quality gate configured.</p>
      </section>
    );
  }

  const assessment = qualityGate.assessment;
  const ruleResults = parseQualityGateRuleResults(qualityGate);
  const live = isEvaluationRunLive(evaluationRun.status);
  const overallVerdict = assessment?.overallVerdict;
  const showPreviewNote =
    live && overallVerdict !== undefined && overallVerdict !== "PASS";

  return (
    <section className="panel">
      <h2 className="panel-title">Quality gate</h2>
      <p className="muted">
        Run status ({evaluationRun.status}) reflects orchestration lifecycle.
        Quality gate verdict is separate and may differ when cases fail scoring
        thresholds while the batch still completes.
      </p>

      {assessment === undefined ? (
        <p className="muted">Assessment pending.</p>
      ) : (
        <dl className="meta-grid">
          <div>
            <dt>Gate verdict</dt>
            <dd>
              <StatusChip
                status={qualityGateVerdictLabel(overallVerdict ?? "—")}
                category={qualityGateVerdictCategory(overallVerdict ?? "")}
              />
            </dd>
          </div>
          <div>
            <dt>Lifecycle check</dt>
            <dd>
              <StatusChip
                status={qualityGateVerdictLabel(assessment.lifecycleVerdict)}
                category={qualityGateVerdictCategory(
                  assessment.lifecycleVerdict,
                )}
              />
            </dd>
          </div>
          <div>
            <dt>Assessed at</dt>
            <dd>{assessment.assessedAt}</dd>
          </div>
        </dl>
      )}

      {live && overallVerdict === "PASS" ? (
        <p className="muted" role="status">
          Final gate pass is available only after the evaluation run completes.
        </p>
      ) : null}
      {showPreviewNote ? (
        <p className="muted">
          Preview metrics only — gate verdict may change when the run finishes.
        </p>
      ) : null}

      {ruleResults.length > 0 ? (
        <table className="data-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Rule</th>
              <th>Threshold</th>
              <th>Observed</th>
              <th>Verdict</th>
              <th>Explanation</th>
            </tr>
          </thead>
          <tbody>
            {ruleResults.map((result) => (
              <tr key={`${result.metric}-${result.operator}`}>
                <td>{result.metric}</td>
                <td>{formatGateOperatorLabel(result.operator)}</td>
                <td>
                  {formatConfiguredGateThreshold(
                    result.metric,
                    result.threshold,
                  )}
                </td>
                <td>
                  {formatObservedGateValue(result.metric, result.observedValue)}
                </td>
                <td>
                  <StatusChip
                    status={qualityGateVerdictLabel(result.verdict)}
                    category={qualityGateVerdictCategory(result.verdict)}
                  />
                </td>
                <td>{qualityGateReasonLabel(result.reasonCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {qualityGate.policy.rules.some(
        (rule) =>
          (rule as { metric?: string }).metric === "ESTIMATED_COST_USD_MICROS",
      ) ? (
        <p className="muted" style={{ marginTop: 12 }}>
          {ESTIMATED_COST_DISCLAIMER}
        </p>
      ) : null}
    </section>
  );
}
