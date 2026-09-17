import type { TraceContextCarrier } from "./instrumentation.js";

/** Transport-only BullMQ metadata key. Never treated as RunAttempt identity. */
export const BULLMQ_TRACE_CARRIER_KEY = "__osvaTraceCarrier";

export interface BullMqTraceCarrierPayload {
  readonly [BULLMQ_TRACE_CARRIER_KEY]?: TraceContextCarrier;
}

export function extractBullMqTraceCarrier(
  data: unknown,
): TraceContextCarrier | undefined {
  if (data === null || typeof data !== "object") {
    return undefined;
  }

  const carrier = (data as BullMqTraceCarrierPayload)[BULLMQ_TRACE_CARRIER_KEY];
  if (carrier === undefined) {
    return undefined;
  }

  if (
    typeof carrier.traceparent !== "string" &&
    typeof carrier.tracestate !== "string"
  ) {
    return undefined;
  }

  return carrier;
}

export function withBullMqTraceCarrier<T extends Record<string, unknown>>(
  payload: T,
  carrier: TraceContextCarrier | undefined,
): T & BullMqTraceCarrierPayload {
  if (carrier === undefined) {
    return payload;
  }

  return {
    ...payload,
    [BULLMQ_TRACE_CARRIER_KEY]: carrier,
  };
}
