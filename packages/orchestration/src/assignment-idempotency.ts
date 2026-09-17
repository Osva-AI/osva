import type { AssignmentId } from "@osva/contracts";

export function assignmentRunIdempotencyKey(
  assignmentId: AssignmentId,
): string {
  return `assignment:${assignmentId}`;
}
