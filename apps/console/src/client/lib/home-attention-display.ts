/** User-facing run status on Home — not a substitute for Run Detail. */
export function homeAttentionStatusLabel(status: string): string {
  switch (status) {
    case "FAILED":
      return "Failed";
    case "TIMED_OUT":
      return "Timed out";
    case "WAITING":
      return "Waiting";
    case "RUNNING":
      return "Running";
    case "PENDING":
    case "QUEUED":
      return "Pending";
    case "SUCCEEDED":
      return "Succeeded";
    case "CANCELLED":
      return "Cancelled";
    default: {
      const normalized = status.replaceAll("_", " ").toLowerCase();
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
  }
}
