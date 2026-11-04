/** User-facing Run / RunStep status labels on Run Detail. */
export function runExecutionStatusLabel(status: string): string {
  switch (status) {
    case "FAILED":
      return "Failed";
    case "TIMED_OUT":
      return "Timed out";
    case "WAITING":
      return "Waiting";
    case "RUNNING":
      return "Running";
    case "QUEUED":
      return "Queued";
    case "PENDING":
      return "Pending";
    case "SUCCEEDED":
      return "Succeeded";
    case "CANCELLED":
      return "Cancelled";
    default: {
      const normalized = status.replaceAll("_", " ").toLowerCase();
      if (normalized.length === 0) {
        return "Unknown";
      }
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
  }
}

export function describeRunStepKind(kind: string): string {
  switch (kind) {
    case "MODEL":
      return "Model call";
    case "TOOL":
      return "Tool call";
    default:
      return kind.replaceAll("_", " ");
  }
}
