import { ConsoleApiError } from "../../lib/console-api";
import { describeConsoleApiError } from "../../lib/operator-diagnostics";
import { OperatorGuidancePanel } from "../operator/operator-guidance";

interface ErrorStateProps {
  readonly title: string;
  readonly error: unknown;
  readonly guidanceContext?:
    | "create_run"
    | "generic"
    | "connector_discover"
    | "connector_import"
    | "model_connectivity";
}

export function ErrorState({
  title,
  error,
  guidanceContext = "generic",
}: ErrorStateProps) {
  const message =
    error instanceof Error ? error.message : "Unexpected error occurred.";
  const requestId =
    error instanceof ConsoleApiError ? error.body.requestId : undefined;
  const guidance = describeConsoleApiError(error, guidanceContext);

  return (
    <div className="error-state" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      {requestId !== undefined ? (
        <p className="mono">Request ID: {requestId}</p>
      ) : null}
      {guidance !== undefined ? (
        <OperatorGuidancePanel guidance={guidance} />
      ) : null}
    </div>
  );
}
