import type { ScheduleId } from "@osva/contracts";

export function scheduleOccurrenceRunIdempotencyKey(
  scheduleId: ScheduleId,
  scheduledFor: Date,
): string {
  return `schedule:${scheduleId}:${scheduledFor.toISOString()}`;
}
