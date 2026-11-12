import type { StatusVisualCategory } from "./statuses";

import type { AssignmentStatus } from "../hooks/use-office";

export function assignmentStatusCategory(
  status: AssignmentStatus,
): StatusVisualCategory {
  switch (status) {
    case "PENDING":
      return "inactive";
    case "RUNNING":
      return "active";
    case "COMPLETED":
      return "success";
    case "FAILED":
      return "error";
    case "CANCELLED":
      return "neutral";
    default:
      return "neutral";
  }
}

export function slugOfficeKeyFromName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 48) : "item";
}
