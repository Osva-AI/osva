export function isEvaluationRunLive(status: string): boolean {
  return status === "PENDING" || status === "RUNNING";
}

export function evaluationRunStatusCategory(
  status: string,
): "neutral" | "active" | "success" | "error" | "inactive" {
  if (status === "RUNNING") {
    return "active";
  }
  if (status === "PENDING") {
    return "neutral";
  }
  if (status === "COMPLETED") {
    return "success";
  }
  if (status === "FAILED") {
    return "error";
  }
  if (status === "CANCELLED") {
    return "inactive";
  }
  return "neutral";
}

export function evaluationCaseOutcomeCategory(
  outcome: string,
): "neutral" | "success" | "error" {
  if (outcome === "PASS") {
    return "success";
  }
  if (outcome === "FAIL") {
    return "error";
  }
  return "neutral";
}

export function formatPassRate(passRate: number): string {
  if (!Number.isFinite(passRate)) {
    return "—";
  }
  return `${(passRate * 100).toFixed(1)}%`;
}
