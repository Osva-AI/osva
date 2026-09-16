import type {
  WorkflowBranchEqualsValue,
  WorkflowDefinitionBranchNodeV2,
} from "@osva/contracts";
import { resolveJsonPointer } from "@osva/contracts";

export function selectBranchTarget(
  node: WorkflowDefinitionBranchNodeV2,
  input: unknown,
): string {
  const resolved = resolveJsonPointer(input, node.selector);
  if (!resolved.found || !isBranchEqualsValue(resolved.value)) {
    return node.defaultTo;
  }

  for (const branchCase of node.cases) {
    if (branchValuesEqual(branchCase.equals, resolved.value)) {
      return branchCase.to;
    }
  }

  return node.defaultTo;
}

function isBranchEqualsValue(
  value: unknown,
): value is WorkflowBranchEqualsValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }

  return typeof value === "number" && Number.isFinite(value);
}

function branchValuesEqual(
  left: WorkflowBranchEqualsValue,
  right: WorkflowBranchEqualsValue,
): boolean {
  return left === right;
}
