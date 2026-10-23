import { JsonView } from "../json-view/json-view";
import { LoadingBlock } from "../loading/loading-block";
import {
  useRunAttemptQuery,
  useRunAttemptsQuery,
  useRunQuery,
} from "../../hooks/use-runs";

export interface EvaluationCaseActualOutputProps {
  readonly runId: string;
  readonly enabled: boolean;
}

export function EvaluationCaseActualOutput({
  runId,
  enabled,
}: EvaluationCaseActualOutputProps) {
  const runQuery = useRunQuery(enabled ? runId : undefined);
  const attemptsQuery = useRunAttemptsQuery(
    enabled ? runId : undefined,
    runQuery.data?.status,
  );
  const latestAttemptId =
    attemptsQuery.data?.attempts[attemptsQuery.data.attempts.length - 1]?.id;
  const latestAttemptMeta = attemptsQuery.data?.attempts.find(
    (attempt) => attempt.id === latestAttemptId,
  );
  const attemptQuery = useRunAttemptQuery(
    enabled ? runId : undefined,
    latestAttemptId,
    latestAttemptMeta?.status,
  );

  if (!enabled) {
    return <span className="muted">—</span>;
  }

  if (runQuery.isLoading || attemptsQuery.isLoading) {
    return <LoadingBlock label="Loading run output…" />;
  }

  if (runQuery.isError) {
    return <span className="muted">Run unavailable</span>;
  }

  const runStatus = runQuery.data?.status;
  if (
    runStatus === undefined ||
    runStatus === "PENDING" ||
    runStatus === "QUEUED" ||
    runStatus === "RUNNING"
  ) {
    return <span className="muted">Run in progress</span>;
  }

  if (attemptQuery.isLoading) {
    return <LoadingBlock label="Loading attempt output…" />;
  }

  if (attemptQuery.data?.output === undefined) {
    return <span className="muted">No output recorded</span>;
  }

  return <JsonView value={attemptQuery.data.output} />;
}
