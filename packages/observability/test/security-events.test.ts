import { afterEach, describe, expect, it } from "vitest";

import { OSVA_METRIC } from "../src/metrics.js";
import { RecordingInstrumentation } from "../src/recording-instrumentation.js";
import {
  emitSecurityEvent,
  resetSecurityEventInstrumentation,
  resetSecurityEventSink,
  SECURITY_EVENT_NAMES,
  setSecurityEventInstrumentation,
  setSecurityEventSink,
} from "../src/security-events.js";

describe("security event metrics", () => {
  afterEach(() => {
    resetSecurityEventSink();
    resetSecurityEventInstrumentation();
  });

  it("records one bounded counter per emitted event", () => {
    const telemetry = new RecordingInstrumentation();
    const events: string[] = [];
    setSecurityEventInstrumentation(telemetry);
    setSecurityEventSink((fields) => {
      events.push(fields.event);
    });

    emitSecurityEvent({
      event: SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_MISSING,
      requestId: "req-1",
      outcome: "DENIED",
    });

    expect(events).toEqual([SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_MISSING]);
    expect(telemetry.countersNamed(OSVA_METRIC.SECURITY_EVENTS)).toEqual([
      {
        name: OSVA_METRIC.SECURITY_EVENTS,
        kind: "counter",
        value: 1,
        attributes: {
          event: SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_MISSING,
          outcome: "DENIED",
        },
      },
    ]);
  });
});
