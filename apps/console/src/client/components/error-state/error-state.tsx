import { ConsoleApiError } from "../../lib/console-api";

interface ErrorStateProps {
  readonly title: string;
  readonly error: unknown;
}

export function ErrorState({ title, error }: ErrorStateProps) {
  const message =
    error instanceof Error ? error.message : "Unexpected error occurred.";
  const requestId =
    error instanceof ConsoleApiError ? error.body.requestId : undefined;

  return (
    <div className="error-state">
      <strong>{title}</strong>
      <p>{message}</p>
      {requestId !== undefined ? (
        <p className="mono">Request ID: {requestId}</p>
      ) : null}
    </div>
  );
}
