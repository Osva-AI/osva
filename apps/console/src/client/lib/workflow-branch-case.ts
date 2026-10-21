import type { WorkflowBranchEqualsValue } from "@osva-ai/contracts";

export type BranchCaseValueKind = "string" | "number" | "boolean" | "null";

export function branchCaseValueKind(
  value: WorkflowBranchEqualsValue,
): BranchCaseValueKind {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  return "string";
}

export function formatBranchCaseForInput(
  value: WorkflowBranchEqualsValue,
): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export function parseBranchCaseInput(
  text: string,
  kind: BranchCaseValueKind,
): WorkflowBranchEqualsValue | undefined {
  if (kind === "null") {
    return null;
  }
  if (kind === "boolean") {
    const normalized = text.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
    return undefined;
  }
  if (kind === "number") {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return parsed;
  }
  return text;
}

export const BRANCH_SELECTOR_PRESETS: readonly {
  readonly label: string;
  readonly pointer: string;
  readonly hint: string;
}[] = [
  {
    label: "Entire previous output",
    pointer: "/",
    hint: "Uses the full JSON value from the previous step.",
  },
  {
    label: "Status field",
    pointer: "/status",
    hint: "Compares the status property on the previous output object.",
  },
  {
    label: "Decision field",
    pointer: "/decision",
    hint: "Compares a decision property on the previous output object.",
  },
];
