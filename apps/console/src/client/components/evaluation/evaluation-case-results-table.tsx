import { Link } from "react-router-dom";

import type {
  EvaluationCaseResource,
  EvaluationCaseResultResource,
} from "../../hooks/use-evaluations";
import { resolveEvaluationCaseExpected } from "../../lib/evaluation-case-expected";
import { evaluationCaseOutcomeCategory } from "../../lib/evaluation-run-status";
import { JsonView } from "../json-view/json-view";
import { StatusChip } from "../status/status-chip";
import { EvaluationCaseActualOutput } from "./evaluation-case-actual-output";

export interface EvaluationCaseRow {
  readonly evaluationCase: EvaluationCaseResource;
  readonly result: EvaluationCaseResultResource | undefined;
  readonly executionLabel: string;
}

export interface EvaluationCaseResultsTableProps {
  readonly rows: readonly EvaluationCaseRow[];
}

export function EvaluationCaseResultsTable({
  rows,
}: EvaluationCaseResultsTableProps) {
  if (rows.length === 0) {
    return <p className="muted">No cases defined for this suite version.</p>;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Case</th>
          <th>Execution</th>
          <th>Outcome</th>
          <th>Expected</th>
          <th>Actual</th>
          <th>Evaluator</th>
          <th>Run</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const expected = resolveEvaluationCaseExpected(row.evaluationCase);
          const showActual =
            row.result !== undefined &&
            (row.result.outcome === "PASS" ||
              row.result.outcome === "FAIL" ||
              row.result.outcome === "ERROR");
          return (
            <tr key={row.evaluationCase.id}>
              <td>
                <div className="mono">{row.evaluationCase.key}</div>
                {row.evaluationCase.name !== undefined ? (
                  <div>{row.evaluationCase.name}</div>
                ) : null}
              </td>
              <td>{row.executionLabel}</td>
              <td>
                {row.result !== undefined ? (
                  <StatusChip
                    status={row.result.outcome}
                    category={evaluationCaseOutcomeCategory(row.result.outcome)}
                  />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {expected !== undefined ? (
                  <JsonView value={expected} />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {row.result !== undefined ? (
                  <EvaluationCaseActualOutput
                    runId={row.result.runId}
                    enabled={showActual}
                  />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {row.result !== undefined ? (
                  <JsonView value={row.result.evaluatorResults} />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {row.result !== undefined ? (
                  <Link
                    className="button button-secondary"
                    to={`/runs/${row.result.runId}`}
                  >
                    Open Run
                  </Link>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function buildEvaluationCaseRows(options: {
  readonly cases: readonly EvaluationCaseResource[];
  readonly results: readonly EvaluationCaseResultResource[];
  readonly evaluationRunStatus: string;
  readonly summaryPendingCases: number;
}): EvaluationCaseRow[] {
  const resultByCaseId = new Map(
    options.results.map((result) => [result.evaluationCaseId, result]),
  );
  const sortedCases = [...options.cases].sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  return sortedCases.map((evaluationCase) => {
    const result = resultByCaseId.get(evaluationCase.id);
    let executionLabel = "Pending";
    if (result !== undefined) {
      executionLabel = "Finished";
    } else if (
      options.evaluationRunStatus === "RUNNING" ||
      options.evaluationRunStatus === "PENDING"
    ) {
      executionLabel =
        options.summaryPendingCases > 0 ? "In progress" : "Pending";
    } else if (
      options.evaluationRunStatus === "COMPLETED" ||
      options.evaluationRunStatus === "FAILED" ||
      options.evaluationRunStatus === "CANCELLED"
    ) {
      executionLabel = "No result";
    }

    return {
      evaluationCase,
      result,
      executionLabel,
    };
  });
}
