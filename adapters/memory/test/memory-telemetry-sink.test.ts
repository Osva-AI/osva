import type { TelemetryEvent, TelemetrySink } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { MemoryTelemetrySink } from "../src/memory-telemetry-sink.js";
import { agentId, runAttemptId, runId, workspaceId } from "./fixtures.js";

describe("MemoryTelemetrySink", () => {
  it("captures events in order with correlation preserved", async () => {
    const sink = new MemoryTelemetrySink();
    const port: TelemetrySink = sink;

    await port.emit({
      name: "run.started",
      occurredAt: "2026-01-15T12:00:00.000Z",
      correlation: {
        workspaceId,
        agentId,
        runId,
        runAttemptId,
      },
      attributes: { attempt: 1 },
    });
    await port.emit({
      name: "run.succeeded",
      occurredAt: "2026-01-15T12:00:01.000Z",
      correlation: { runId, runAttemptId },
    });

    const events = sink.snapshot();
    expect(events.map((event) => event.name)).toEqual([
      "run.started",
      "run.succeeded",
    ]);
    expect(events[0]?.correlation).toEqual({
      workspaceId,
      agentId,
      runId,
      runAttemptId,
    });
    expect(events[1]?.correlation.runId).toBe(runId);
    expect(events[1]?.correlation.runAttemptId).toBe(runAttemptId);
  });

  it("defensively copies input so later mutation does not change recorded events", async () => {
    const sink = new MemoryTelemetrySink();
    const correlation = { runId, runAttemptId };
    const attributes: Record<string, unknown> = { tokenCount: 12 };
    const event = {
      name: "step.completed",
      occurredAt: "2026-01-15T12:00:00.000Z",
      correlation,
      attributes,
    };

    await sink.emit(event);
    event.name = "mutated";
    correlation.runId = "other-run" as typeof runId;
    attributes.tokenCount = 99;

    const recorded = sink.snapshot()[0];
    expect(recorded?.name).toBe("step.completed");
    expect(recorded?.correlation.runId).toBe(runId);
    expect(recorded?.attributes?.tokenCount).toBe(12);
  });

  it("returns an immutable snapshot", async () => {
    const sink = new MemoryTelemetrySink();
    await sink.emit({
      name: "run.queued",
      occurredAt: "2026-01-15T12:00:00.000Z",
      correlation: { runId },
      attributes: { queue: "memory" },
    });

    const snapshot = sink.snapshot();
    expect(() => {
      (snapshot as TelemetryEvent[]).push({
        name: "injected",
        occurredAt: "2026-01-15T12:00:02.000Z",
        correlation: {},
      });
    }).toThrow(TypeError);

    expect(() => {
      (snapshot[0] as { name: string }).name = "mutated";
    }).toThrow(TypeError);

    expect(() => {
      (snapshot[0]?.attributes as Record<string, unknown>).queue = "other";
    }).toThrow(TypeError);

    expect(sink.snapshot()[0]?.name).toBe("run.queued");
    expect(sink.snapshot()[0]?.attributes?.queue).toBe("memory");
  });
});
