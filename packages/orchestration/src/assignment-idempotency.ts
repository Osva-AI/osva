import type { AssignmentId } from "@osva-ai/contracts";

export function assignmentRunIdempotencyKey(
  assignmentId: AssignmentId,
): string {
  return `assignment:${assignmentId}`;
}
