import type {
  WorkflowEventId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { DomainInvariantError } from "../src/errors.js";
import { armWorkflowWait, WorkflowWait } from "../src/workflow-wait.js";

const workspaceId = "ws-1" as WorkspaceId;
const workflowRunId = "wr-1" as WorkflowRunId;
const workflowNodeRunId = "wnr-1" as WorkflowNodeRunId;
const runCreated = new Date("2026-01-01T10:00:00.000Z");
const armedAt = new Date("2026-01-01T10:05:00.000Z");
const eventTimeoutMs = 55 * 60_000;

function armedTimer(): WorkflowWait {
  return armWorkflowWait({
    workspaceId,
    workflowRunId,
    workflowNodeRunId,
    workflowRunCreatedAt: runCreated,
    armedAt,
    nodeInput: {},
    wait: { kind: "DURATION", durationMs: 60_000 },
  });
}

function armedEvent(): WorkflowWait {
  return armWorkflowWait({
    workspaceId,
    workflowRunId,
    workflowNodeRunId,
    workflowRunCreatedAt: runCreated,
    armedAt,
    nodeInput: { orderId: "ord-1" },
    wait: {
      kind: "EVENT",
      source: "payments",
      eventType: "payment.completed",
      correlation: { kind: "LITERAL", value: "ord-1" },
      timeoutMs: eventTimeoutMs,
    },
  });
}

function timerProps(
  overrides: Partial<Parameters<typeof WorkflowWait.rehydrate>[0]> = {},
) {
  const wait = armedTimer();
  return {
    workspaceId,
    workflowRunId,
    workflowNodeRunId,
    kind: "TIMER" as const,
    armedAt: wait.armedAt,
    wakeAt: wait.wakeAt!,
    ...overrides,
  };
}

function eventProps(
  overrides: Partial<Parameters<typeof WorkflowWait.rehydrate>[0]> = {},
) {
  const wait = armedEvent();
  return {
    workspaceId,
    workflowRunId,
    workflowNodeRunId,
    kind: "EVENT" as const,
    armedAt: wait.armedAt,
    eventSource: wait.eventSource!,
    eventType: wait.eventType!,
    correlationKey: wait.correlationKey!,
    eligibleFrom: wait.eligibleFrom!,
    expiresAt: wait.expiresAt,
    ...overrides,
  };
}

describe("WorkflowWait.rehydrate TIMER", () => {
  it("rehydrates active and resolved TIMER waits", () => {
    const active = WorkflowWait.rehydrate(timerProps());
    expect(active.isActive()).toBe(true);
    expect(active.wakeAt?.toISOString()).toBe("2026-01-01T10:06:00.000Z");

    const resolved = WorkflowWait.rehydrate(
      timerProps({
        resolution: "TIMER",
        resolvedAt: new Date("2026-01-01T10:07:00.000Z"),
      }),
    );
    expect(resolved.resolution).toBe("TIMER");

    const cancelled = WorkflowWait.rehydrate(
      timerProps({
        resolution: "CANCELLED",
        resolvedAt: new Date("2026-01-01T10:07:00.000Z"),
      }),
    );
    expect(cancelled.resolution).toBe("CANCELLED");
  });

  it("allows wakeAt before armedAt for persisted UNTIL-style timers", () => {
    const wait = WorkflowWait.rehydrate(
      timerProps({
        armedAt: new Date("2026-01-01T10:05:00.000Z"),
        wakeAt: new Date("2026-01-01T10:00:00.000Z"),
      }),
    );
    expect(wait.wakeAt!.getTime()).toBeLessThan(wait.armedAt.getTime());
  });

  it("rejects invalid TIMER resolutions and half-resolved state", () => {
    expect(() =>
      WorkflowWait.rehydrate(
        timerProps({ resolution: "EVENT", resolvedAt: armedAt }),
      ),
    ).toThrow(DomainInvariantError);
    expect(() =>
      WorkflowWait.rehydrate(
        timerProps({ resolution: "TIMEOUT", resolvedAt: armedAt }),
      ),
    ).toThrow(DomainInvariantError);
    expect(() =>
      WorkflowWait.rehydrate(timerProps({ resolution: "TIMER" })),
    ).toThrow(DomainInvariantError);
    expect(() =>
      WorkflowWait.rehydrate(timerProps({ resolvedAt: armedAt })),
    ).toThrow(DomainInvariantError);
  });
});

describe("WorkflowWait.rehydrate EVENT", () => {
  it("rehydrates active and resolved EVENT waits", () => {
    const active = WorkflowWait.rehydrate(eventProps());
    expect(active.isActive()).toBe(true);

    const eventResolved = WorkflowWait.rehydrate(
      eventProps({
        resolution: "EVENT",
        resolvedAt: new Date("2026-01-01T11:05:00.000Z"),
        resolvedByEventId: "we-1" as WorkflowEventId,
      }),
    );
    expect(eventResolved.resolution).toBe("EVENT");
    expect(eventResolved.resolvedByEventId).toBe("we-1");

    const timedOut = WorkflowWait.rehydrate(
      eventProps({
        resolution: "TIMEOUT",
        resolvedAt: new Date("2026-01-01T11:00:00.000Z"),
      }),
    );
    expect(timedOut.resolution).toBe("TIMEOUT");
  });

  it("allows EVENT resolution after expiresAt when event was received on time", () => {
    const wait = WorkflowWait.rehydrate(
      eventProps({
        resolution: "EVENT",
        resolvedAt: new Date("2026-01-01T11:05:00.000Z"),
        resolvedByEventId: "we-late-process" as WorkflowEventId,
      }),
    );
    expect(wait.resolvedAt!.getTime()).toBeGreaterThan(
      wait.expiresAt!.getTime(),
    );
  });

  it("rejects incompatible persisted EVENT state", () => {
    expect(() =>
      WorkflowWait.rehydrate(
        eventProps({ resolution: "TIMER", resolvedAt: armedAt }),
      ),
    ).toThrow(DomainInvariantError);
    expect(() =>
      WorkflowWait.rehydrate(
        eventProps({
          resolution: "EVENT",
          resolvedAt: armedAt,
        }),
      ),
    ).toThrow(DomainInvariantError);
    expect(() =>
      WorkflowWait.rehydrate(
        eventProps({
          resolution: "TIMEOUT",
          resolvedAt: armedAt,
          expiresAt: undefined,
        }),
      ),
    ).toThrow(DomainInvariantError);
    expect(() =>
      WorkflowWait.rehydrate(
        eventProps({
          resolution: "CANCELLED",
          resolvedAt: armedAt,
          resolvedByEventId: "we-1" as WorkflowEventId,
        }),
      ),
    ).toThrow(DomainInvariantError);
    expect(() =>
      WorkflowWait.rehydrate(
        eventProps({
          eligibleFrom: new Date("2026-01-01T10:06:00.000Z"),
        }),
      ),
    ).toThrow(DomainInvariantError);
    expect(() =>
      WorkflowWait.rehydrate(
        eventProps({
          expiresAt: armedAt,
        }),
      ),
    ).toThrow(DomainInvariantError);
  });
});

describe("WorkflowWait.rehydrate round-trip", () => {
  it("preserves armed domain state without recomputing criteria", () => {
    const armed = armedEvent();
    const rehydrated = WorkflowWait.rehydrate({
      workspaceId: armed.workspaceId,
      workflowRunId: armed.workflowRunId,
      workflowNodeRunId: armed.workflowNodeRunId,
      kind: armed.kind,
      armedAt: armed.armedAt,
      eventSource: armed.eventSource!,
      eventType: armed.eventType!,
      correlationKey: armed.correlationKey!,
      eligibleFrom: armed.eligibleFrom!,
      expiresAt: armed.expiresAt,
    });
    expect(rehydrated.correlationKey).toBe(armed.correlationKey);
    expect(rehydrated.expiresAt?.toISOString()).toBe(
      armed.expiresAt?.toISOString(),
    );
  });
});
