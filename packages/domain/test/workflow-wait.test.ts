import type {
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  DomainInvariantError,
  WorkflowWaitCorrelationResolutionError,
  WorkflowWaitResolutionConflictError,
  WorkflowWaitResolutionNotDueError,
} from "../src/errors.js";
import { armWorkflowWait, WorkflowWait } from "../src/workflow-wait.js";

const workspaceId = "ws-1" as WorkspaceId;
const workflowRunId = "wr-1" as WorkflowRunId;
const workflowNodeRunId = "wnr-1" as WorkflowNodeRunId;
const runCreated = new Date("2026-01-01T00:00:00.000Z");
const armedAt = new Date("2026-01-01T01:00:00.000Z");

function arm(
  wait: Parameters<typeof armWorkflowWait>[0]["wait"],
  nodeInput: unknown = {},
  options?: {
    armedAt?: Date;
    workflowRunCreatedAt?: Date;
  },
): WorkflowWait {
  return armWorkflowWait({
    workspaceId,
    workflowRunId,
    workflowNodeRunId,
    workflowRunCreatedAt: options?.workflowRunCreatedAt ?? runCreated,
    wait,
    nodeInput,
    armedAt: options?.armedAt ?? armedAt,
  });
}

describe("WorkflowWait DURATION arming", () => {
  it("arms TIMER with wakeAt = armedAt + durationMs", () => {
    const wait = arm({ kind: "DURATION", durationMs: 60_000 });
    expect(wait.kind).toBe("TIMER");
    expect(wait.wakeAt?.toISOString()).toBe("2026-01-01T01:01:00.000Z");
    expect(wait.armedAt.toISOString()).toBe(armedAt.toISOString());
    expect(wait.isActive()).toBe(true);
    expect(wait.workflowNodeRunId).toBe(workflowNodeRunId);
  });

  it("rejects timestamp overflow", () => {
    expect(() =>
      arm(
        { kind: "DURATION", durationMs: 1 },
        {},
        { armedAt: new Date(8_640_000_000_000_000) },
      ),
    ).toThrow(DomainInvariantError);
  });
});

describe("WorkflowWait TIMER due and resolution", () => {
  const durationWait = () => arm({ kind: "DURATION", durationMs: 60_000 });

  it("is not due before wakeAt and is due at or after wakeAt", () => {
    const wait = durationWait();
    expect(wait.isTimerDue(new Date("2026-01-01T01:00:59.999Z"))).toBe(false);
    expect(wait.isTimerDue(new Date("2026-01-01T01:01:00.000Z"))).toBe(true);
    expect(wait.isTimerDue(new Date("2026-01-01T01:05:00.000Z"))).toBe(true);
  });

  it("cannot resolve before wakeAt", () => {
    const wait = durationWait();
    expect(() =>
      wait.resolveTimer(new Date("2026-01-01T01:00:30.000Z")),
    ).toThrow(WorkflowWaitResolutionNotDueError);
  });

  it("resolves once and duplicate resolution is idempotent", () => {
    const wait = durationWait();
    const first = wait.resolveTimer(new Date("2026-01-01T01:02:00.000Z"));
    expect(first.resolution).toBe("TIMER");
    expect(first.resolvedAt?.toISOString()).toBe("2026-01-01T01:02:00.000Z");

    const second = first.resolveTimer(new Date("2026-01-01T01:03:00.000Z"));
    expect(second).toBe(first);
    expect(second.resolvedAt?.toISOString()).toBe("2026-01-01T01:02:00.000Z");
  });
});

describe("WorkflowWait UNTIL arming", () => {
  it("preserves the requested instant even when before armedAt", () => {
    const wait = arm({
      kind: "UNTIL",
      until: "2026-10-01T10:00:00Z",
    });
    expect(wait.wakeAt?.toISOString()).toBe("2026-10-01T10:00:00.000Z");

    const past = arm(
      { kind: "UNTIL", until: "2026-01-01T00:30:00Z" },
      {},
      { armedAt: new Date("2026-01-01T01:00:00Z") },
    );
    expect(past.isTimerDue(new Date("2026-01-01T01:00:00Z"))).toBe(true);
    expect(past.wakeAt?.toISOString()).toBe("2026-01-01T00:30:00.000Z");

    const future = arm({
      kind: "UNTIL",
      until: "2026-12-31T23:59:59Z",
    });
    expect(future.isTimerDue(armedAt)).toBe(false);
  });
});

describe("WorkflowWait EVENT arming", () => {
  it("freezes LITERAL correlation and eligibleFrom from workflow run creation", () => {
    const wait = arm({
      kind: "EVENT",
      source: "payments",
      eventType: "payment.completed",
      correlation: { kind: "LITERAL", value: "order_123" },
    });
    expect(wait.kind).toBe("EVENT");
    expect(wait.correlationKey).toBe("order_123");
    expect(wait.eventSource).toBe("payments");
    expect(wait.eventType).toBe("payment.completed");
    expect(wait.eligibleFrom?.toISOString()).toBe(runCreated.toISOString());
    expect(wait.armedAt.toISOString()).toBe(armedAt.toISOString());
    expect(wait.eligibleFrom?.getTime()).not.toBe(wait.armedAt.getTime());
    expect(wait.expiresAt).toBeUndefined();
  });

  it("calculates expiresAt when timeoutMs is supplied", () => {
    const wait = arm({
      kind: "EVENT",
      source: "payments",
      eventType: "payment.completed",
      correlation: { kind: "LITERAL", value: "x" },
      timeoutMs: 3_600_000,
    });
    expect(wait.expiresAt?.toISOString()).toBe("2026-01-01T02:00:00.000Z");
  });
});

describe("WorkflowWait EVENT INPUT_POINTER correlation", () => {
  it("resolves object, nested, array, and escape tokens", () => {
    const input = {
      orderId: "ord-1",
      nested: { "a/b": "slash-key" },
      items: ["first", "second"],
      plain: "whole-doc",
    };

    expect(
      arm(
        {
          kind: "EVENT",
          source: "s",
          eventType: "t",
          correlation: { kind: "INPUT_POINTER", pointer: "/orderId" },
        },
        input,
      ).correlationKey,
    ).toBe("ord-1");

    expect(
      arm(
        {
          kind: "EVENT",
          source: "s",
          eventType: "t",
          correlation: { kind: "INPUT_POINTER", pointer: "/nested/a~1b" },
        },
        input,
      ).correlationKey,
    ).toBe("slash-key");

    expect(
      arm(
        {
          kind: "EVENT",
          source: "s",
          eventType: "t",
          correlation: { kind: "INPUT_POINTER", pointer: "/items/1" },
        },
        input,
      ).correlationKey,
    ).toBe("second");

    expect(
      arm(
        {
          kind: "EVENT",
          source: "s",
          eventType: "t",
          correlation: { kind: "INPUT_POINTER", pointer: "" },
        },
        "payload-id",
      ).correlationKey,
    ).toBe("payload-id");
  });

  it("rejects missing pointer, non-string, and empty string", () => {
    const input = { orderId: 42, empty: "" };
    const event = (pointer: string) =>
      arm(
        {
          kind: "EVENT",
          source: "s",
          eventType: "t",
          correlation: { kind: "INPUT_POINTER", pointer },
        },
        input,
      );

    expect(() => event("/missing")).toThrow(
      WorkflowWaitCorrelationResolutionError,
    );
    expect(() => event("/orderId")).toThrow(
      WorkflowWaitCorrelationResolutionError,
    );
    expect(() => event("/empty")).toThrow(
      WorkflowWaitCorrelationResolutionError,
    );
  });
});

describe("WorkflowWait EVENT timeout predicate and resolution", () => {
  const eventWithTimeout = () =>
    arm({
      kind: "EVENT",
      source: "payments",
      eventType: "payment.completed",
      correlation: { kind: "LITERAL", value: "x" },
      timeoutMs: 60_000,
    });

  it("deadline predicate without implying workflow failure", () => {
    const wait = eventWithTimeout();
    expect(
      wait.isEventTimeoutDeadlineReached(new Date("2026-01-01T01:00:59.999Z")),
    ).toBe(false);
    expect(
      wait.isEventTimeoutDeadlineReached(new Date("2026-01-01T01:01:00.000Z")),
    ).toBe(true);
  });

  it("resolveTimeout requires deadline and is idempotent", () => {
    const wait = eventWithTimeout();
    expect(() =>
      wait.resolveTimeout(new Date("2026-01-01T01:00:30.000Z")),
    ).toThrow(WorkflowWaitResolutionNotDueError);

    const resolved = wait.resolveTimeout(new Date("2026-01-01T01:02:00.000Z"));
    expect(resolved.resolution).toBe("TIMEOUT");
    const again = resolved.resolveTimeout(new Date("2026-01-01T01:03:00.000Z"));
    expect(again).toBe(resolved);
  });

  it("cannot resolveTimeout without expiresAt", () => {
    const wait = arm({
      kind: "EVENT",
      source: "s",
      eventType: "t",
      correlation: { kind: "LITERAL", value: "x" },
    });
    expect(() =>
      wait.resolveTimeout(new Date("2026-01-01T02:00:00.000Z")),
    ).toThrow(DomainInvariantError);
  });
});

describe("WorkflowWait cancellation and conflicts", () => {
  it("cancels active TIMER and EVENT waits idempotently", () => {
    const timer = arm({ kind: "DURATION", durationMs: 60_000 });
    const cancelled = timer.cancel(new Date("2026-01-01T01:00:30.000Z"));
    expect(cancelled.resolution).toBe("CANCELLED");
    expect(cancelled.cancel(new Date("2026-01-01T01:01:00.000Z"))).toBe(
      cancelled,
    );

    const event = arm({
      kind: "EVENT",
      source: "s",
      eventType: "t",
      correlation: { kind: "LITERAL", value: "x" },
    });
    expect(event.cancel(new Date("2026-01-01T01:00:30.000Z")).resolution).toBe(
      "CANCELLED",
    );
  });

  it("rejects conflicting resolutions", () => {
    const timer = arm({ kind: "DURATION", durationMs: 1_000 });
    const resolved = timer.resolveTimer(new Date("2026-01-01T01:01:00.000Z"));
    expect(() => resolved.cancel(new Date("2026-01-01T01:02:00.000Z"))).toThrow(
      WorkflowWaitResolutionConflictError,
    );

    const event = arm({
      kind: "EVENT",
      source: "s",
      eventType: "t",
      correlation: { kind: "LITERAL", value: "x" },
      timeoutMs: 1_000,
    });
    const timedOut = event.resolveTimeout(new Date("2026-01-01T01:02:00.000Z"));
    expect(() => timedOut.cancel(new Date("2026-01-01T01:03:00.000Z"))).toThrow(
      WorkflowWaitResolutionConflictError,
    );

    const cancelled = arm({
      kind: "DURATION",
      durationMs: 1_000,
    }).cancel(new Date("2026-01-01T01:00:30.000Z"));
    expect(() =>
      cancelled.resolveTimer(new Date("2026-01-01T01:02:00.000Z")),
    ).toThrow(WorkflowWaitResolutionConflictError);
  });
});

describe("WorkflowWait invariants", () => {
  it("rejects workflowRunCreatedAt after armedAt and invalid dates", () => {
    expect(() =>
      arm(
        { kind: "DURATION", durationMs: 1_000 },
        {},
        {
          workflowRunCreatedAt: new Date("2026-02-01T00:00:00Z"),
          armedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ),
    ).toThrow(DomainInvariantError);

    expect(() =>
      armWorkflowWait({
        workspaceId,
        workflowRunId,
        workflowNodeRunId,
        workflowRunCreatedAt: runCreated,
        wait: { kind: "DURATION", durationMs: 1_000 },
        nodeInput: {},
        armedAt: new Date("invalid"),
      }),
    ).toThrow(DomainInvariantError);
  });

  it("does not expose a WorkflowWaitId", () => {
    const wait = arm({ kind: "DURATION", durationMs: 1_000 });
    expect("id" in wait).toBe(false);
  });
});
