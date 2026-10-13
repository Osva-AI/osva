import { OSVA_EXECUTION_QUEUE_NAME } from "./constants.js";

export const QUEUE_METRIC_STATES = [
  "waiting",
  "active",
  "delayed",
  "failed",
] as const;

export type QueueMetricState = (typeof QUEUE_METRIC_STATES)[number];

export const DEFAULT_QUEUE_METRICS_POLL_MS = 5_000;

export function queueMetricLabel(queueName: string): string {
  return queueName === OSVA_EXECUTION_QUEUE_NAME ? "execution" : "other";
}

export function queueTimeToStartMs(
  enqueuedAt: number | undefined,
  startedAt: number,
): number | undefined {
  if (
    enqueuedAt === undefined ||
    !Number.isFinite(enqueuedAt) ||
    enqueuedAt <= 0 ||
    startedAt < enqueuedAt
  ) {
    return undefined;
  }

  return startedAt - enqueuedAt;
}
