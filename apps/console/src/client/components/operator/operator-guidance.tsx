import type { OperatorGuidance } from "../../lib/operator-diagnostics";

interface OperatorGuidancePanelProps {
  readonly guidance: OperatorGuidance;
  readonly testId?: string;
}

export function OperatorGuidancePanel({
  guidance,
  testId,
}: OperatorGuidancePanelProps) {
  const role =
    guidance.severity === "error"
      ? "alert"
      : guidance.severity === "warning"
        ? "status"
        : "status";

  return (
    <aside
      className={`operator-guidance operator-guidance-${guidance.severity}`}
      role={role}
      aria-live={guidance.severity === "error" ? "assertive" : "polite"}
      data-testid={testId}
    >
      <strong>{guidance.title}</strong>
      <p>{guidance.explanation}</p>
      {guidance.nextSteps.length > 0 ? (
        <ul>
          {guidance.nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : null}
      {guidance.recoverable === false ? (
        <p className="muted">This attempt is not automatically recoverable.</p>
      ) : null}
    </aside>
  );
}
