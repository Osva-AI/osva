import type { EvaluationRunResource } from "../hooks/use-evaluations";

export function describeTestingExecuteRoleRequirement(): string {
  return "Your workspace role cannot EXECUTE evaluations. Launching evaluations and running the playground requires execute permission (Developer, Admin, or Owner with EXECUTE).";
}

export function describeTestingWriteRoleRequirement(): string {
  return "Creating evaluation suites requires Developer, Admin, or Owner.";
}

export function formatEvaluationRunStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "RUNNING":
      return "Running";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function formatEvaluationTargetSummary(
  run: EvaluationRunResource,
): string {
  if (run.targetType === "AGENT_VERSION") {
    return "Agent version";
  }
  return run.targetType.replaceAll("_", " ");
}

export function evaluationRunGateHint(runStatus: string): string {
  if (runStatus === "PENDING" || runStatus === "RUNNING") {
    return "Quality gate assessed after run completes";
  }
  if (runStatus === "COMPLETED") {
    return "Open run for gate verdict (may differ from COMPLETED)";
  }
  return "—";
}
