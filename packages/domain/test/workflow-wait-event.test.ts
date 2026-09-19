import type {
  JsonValue,
  WorkflowEventId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  DomainInvariantError,
  WorkflowWaitEventNotEligibleError,
  WorkflowWaitResolutionConflictError,
} from "../src/errors.js";
import { WorkflowEvent } from "../src/workflow-event.js";
import { armWorkflowWait, WorkflowWait } from "../src/workflow-wait.js";
import {
  decideWorkflowEventWait,
  isWorkflowEventEligibleForWait,
  matchesWorkflowEventWait,
  selectWorkflowEventForWait,
} from "../src/workflow-wait-event.js";

const workspaceId = "ws-1" as WorkspaceId;
const workflowRunId = "wr-1" as WorkflowRunId;
const workflowNodeRunId = "wnr-1" as WorkflowNodeRunId;
const runCreated = new Date("2026-01-01T10:00:00.000Z");
const armedAt = new Date("2026-01-01T10:05:00.000Z");
/** armedAt + 55m → 11:00:00Z */
const eventTimeoutMs = 55 * 60_000;

function eventWait(timeoutMs?: number): WorkflowWait {
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
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  });
}

function event(
  id: string,
  receivedAt: Date,
  overrides: Partial<{
    source: string;
    eventType: string;
    correlationKey: string;
    occurredAt: Date;
    workspaceId: WorkspaceId;
  }> = {},
): WorkflowEvent {
  return WorkflowEvent.create({
    id: id as WorkflowEventId,
    workspaceId: overrides.workspaceId ?? workspaceId,
    source: overrides.source ?? "payments",
    eventType: overrides.eventType ?? "payment.completed",
    correlationKey: overrides.correlationKey ?? "ord-1",
    idempotencyKey: `idem-${id}`,
    payload: { ok: true } as JsonValue,
    occurredAt: overrides.occurredAt,
    receivedAt,
  });
}

describe("matchesWorkflowEventWait", () => {
  it("requires exact workspace, source, eventType, and correlationKey", () => {
    const wait = eventWait();
    const match = event("e1", new Date("2026-01-01T10:01:00.000Z"));
    expect(matchesWorkflowEventWait(wait, match)).toBe(true);
    expect(
      matchesWorkflowEventWait(
        wait,
        event("e2", match.receivedAt, { workspaceId: "ws-2" as WorkspaceId }),
      ),
    ).toBe(false);
    expect(
      matchesWorkflowEventWait(
        wait,
        event("e3", match.receivedAt, { source: "shopify" }),
      ),
    ).toBe(false);
    expect(
      matchesWorkflowEventWait(
        wait,
        event("e4", match.receivedAt, { eventType: "payment.failed" }),
      ),
    ).toBe(false);
    expect(
      matchesWorkflowEventWait(
        wait,
        event("e5", match.receivedAt, { correlationKey: "other" }),
      ),
    ).toBe(false);
  });

  it("returns false for TIMER waits", () => {
    const timer = armWorkflowWait({
      workspaceId,
      workflowRunId,
      workflowNodeRunId,
      workflowRunCreatedAt: runCreated,
      armedAt,
      nodeInput: {},
      wait: { kind: "DURATION", durationMs: 60_000 },
    });
    expect(
      matchesWorkflowEventWait(
        timer,
        event("e1", new Date("2026-01-01T10:06:00.000Z")),
      ),
    ).toBe(false);
  });
});

describe("event eligibility window", () => {
  const wait = eventWait(eventTimeoutMs);

  it("uses eligibleFrom from workflow run creation, not armedAt", () => {
    const early = event("early", new Date("2026-01-01T10:01:00.000Z"));
    expect(isWorkflowEventEligibleForWait(wait, early, armedAt)).toBe(true);
    expect(
      isWorkflowEventEligibleForWait(
        wait,
        event("before-run", new Date("2026-01-01T09:59:59.000Z")),
        armedAt,
      ),
    ).toBe(false);
    expect(
      isWorkflowEventEligibleForWait(
        wait,
        event("exact-run", new Date("2026-01-01T10:00:00.000Z")),
        armedAt,
      ),
    ).toBe(true);
  });

  it("respects expiresAt and now boundaries inclusively", () => {
    const atExpiry = event("at-exp", new Date("2026-01-01T11:00:00.000Z"));
    expect(
      isWorkflowEventEligibleForWait(
        wait,
        atExpiry,
        new Date("2026-01-01T11:05:00.000Z"),
      ),
    ).toBe(true);

    const late = event("late", new Date("2026-01-01T11:00:01.000Z"));
    expect(
      isWorkflowEventEligibleForWait(
        wait,
        late,
        new Date("2026-01-01T11:05:00.000Z"),
      ),
    ).toBe(false);

    const future = event("future", new Date("2026-01-01T10:30:00.000Z"));
    expect(
      isWorkflowEventEligibleForWait(
        wait,
        future,
        new Date("2026-01-01T10:20:00.000Z"),
      ),
    ).toBe(false);

    const skewedOccurred = event("skew", new Date("2026-01-01T10:30:00.000Z"), {
      occurredAt: new Date("2026-01-01T09:00:00.000Z"),
    });
    expect(
      isWorkflowEventEligibleForWait(
        wait,
        skewedOccurred,
        new Date("2026-01-01T10:31:00.000Z"),
      ),
    ).toBe(true);
  });
});

describe("selectWorkflowEventForWait", () => {
  it("selects earliest receivedAt and breaks ties by WorkflowEventId", () => {
    const wait = eventWait();
    const e2 = event("we-2", new Date("2026-01-01T10:02:00.000Z"));
    const e1 = event("we-1", new Date("2026-01-01T10:01:00.000Z"));
    const e3 = event("we-3", new Date("2026-01-01T10:01:00.000Z"));

    expect(selectWorkflowEventForWait(wait, [e2, e3, e1], armedAt)?.id).toBe(
      "we-1",
    );
    expect(selectWorkflowEventForWait(wait, [e3, e2, e1], armedAt)?.id).toBe(
      "we-1",
    );
  });

  it("ignores nonmatching events", () => {
    const wait = eventWait();
    const winner = event("we-win", new Date("2026-01-01T10:02:00.000Z"));
    const other = event("we-other", new Date("2026-01-01T10:01:00.000Z"), {
      correlationKey: "nope",
    });
    expect(selectWorkflowEventForWait(wait, [other, winner], armedAt)?.id).toBe(
      "we-win",
    );
  });
});

describe("decideWorkflowEventWait", () => {
  const wait = eventWait(eventTimeoutMs);

  it("covers the six precedence cases", () => {
    const eligible = event("we-1", new Date("2026-01-01T10:59:00.000Z"));
    expect(
      decideWorkflowEventWait(
        wait,
        [eligible],
        new Date("2026-01-01T11:05:00.000Z"),
      ),
    ).toEqual({ kind: "EVENT", event: eligible });

    const atExpiry = event("we-2", new Date("2026-01-01T11:00:00.000Z"));
    expect(
      decideWorkflowEventWait(
        wait,
        [atExpiry],
        new Date("2026-01-01T11:05:00.000Z"),
      ),
    ).toEqual({ kind: "EVENT", event: atExpiry });

    const late = event("we-late", new Date("2026-01-01T11:00:01.000Z"));
    expect(
      decideWorkflowEventWait(
        wait,
        [late],
        new Date("2026-01-01T11:05:00.000Z"),
      ),
    ).toEqual({ kind: "TIMEOUT" });

    expect(
      decideWorkflowEventWait(wait, [], new Date("2026-01-01T10:59:00.000Z")),
    ).toEqual({ kind: "PENDING" });

    expect(
      decideWorkflowEventWait(wait, [], new Date("2026-01-01T11:00:00.000Z")),
    ).toEqual({ kind: "TIMEOUT" });

    const noTimeout = eventWait();
    expect(
      decideWorkflowEventWait(
        noTimeout,
        [],
        new Date("2026-12-31T00:00:00.000Z"),
      ),
    ).toEqual({ kind: "PENDING" });
  });

  it("prefers eligible event over timeout when deadline passed", () => {
    const eligible = event("we-1", new Date("2026-01-01T10:59:00.000Z"));
    const lateMismatch = event("we-2", new Date("2026-01-01T11:00:01.000Z"));
    expect(
      decideWorkflowEventWait(
        wait,
        [lateMismatch, eligible],
        new Date("2026-01-01T11:05:00.000Z"),
      ).kind,
    ).toBe("EVENT");
  });

  it("rejects decisions on resolved waits", () => {
    const resolved = eventWait(eventTimeoutMs).resolveTimeout(
      new Date("2026-01-01T11:00:00.000Z"),
    );
    expect(() =>
      decideWorkflowEventWait(
        resolved,
        [],
        new Date("2026-01-01T12:00:00.000Z"),
      ),
    ).toThrow(DomainInvariantError);
  });
});

describe("WorkflowWait.resolveEvent", () => {
  it("resolves with EVENT and resolvedByEventId without copying payload", () => {
    const wait = eventWait(eventTimeoutMs);
    const received = event("we-1", new Date("2026-01-01T10:59:00.000Z"));
    const resolved = wait.resolveEvent(
      received,
      new Date("2026-01-01T11:05:00.000Z"),
    );
    expect(resolved.resolution).toBe("EVENT");
    expect(resolved.resolvedByEventId).toBe("we-1");
    expect(resolved.resolvedAt?.toISOString()).toBe("2026-01-01T11:05:00.000Z");
    expect("payload" in resolved).toBe(false);
  });

  it("is idempotent for the same event and conflicts otherwise", () => {
    const wait = eventWait(eventTimeoutMs);
    const firstEvent = event("we-1", new Date("2026-01-01T10:59:00.000Z"));
    const resolved = wait.resolveEvent(
      firstEvent,
      new Date("2026-01-01T11:05:00.000Z"),
    );
    const again = resolved.resolveEvent(
      firstEvent,
      new Date("2026-01-01T11:10:00.000Z"),
    );
    expect(again).toBe(resolved);
    expect(again.resolvedAt?.toISOString()).toBe("2026-01-01T11:05:00.000Z");

    const other = event("we-2", new Date("2026-01-01T10:58:00.000Z"));
    expect(() =>
      resolved.resolveEvent(other, new Date("2026-01-01T11:06:00.000Z")),
    ).toThrow(WorkflowWaitResolutionConflictError);

    const timedOut = eventWait(1_000).resolveTimeout(
      new Date("2026-01-01T10:06:00.000Z"),
    );
    expect(() =>
      timedOut.resolveEvent(firstEvent, new Date("2026-01-01T10:07:00.000Z")),
    ).toThrow(WorkflowWaitResolutionConflictError);

    const cancelled = eventWait().cancel(new Date("2026-01-01T10:06:00.000Z"));
    expect(() =>
      cancelled.resolveEvent(firstEvent, new Date("2026-01-01T10:07:00.000Z")),
    ).toThrow(WorkflowWaitResolutionConflictError);

    const eventResolved = wait.resolveEvent(
      firstEvent,
      new Date("2026-01-01T11:05:00.000Z"),
    );
    expect(() =>
      eventResolved.resolveTimeout(new Date("2026-01-01T11:06:00.000Z")),
    ).toThrow(WorkflowWaitResolutionConflictError);
    expect(() =>
      eventResolved.cancel(new Date("2026-01-01T11:06:00.000Z")),
    ).toThrow(WorkflowWaitResolutionConflictError);
  });

  it("rejects ineligible events", () => {
    const wait = eventWait(eventTimeoutMs);
    const late = event("we-late", new Date("2026-01-01T11:00:01.000Z"));
    expect(() =>
      wait.resolveEvent(late, new Date("2026-01-01T11:05:00.000Z")),
    ).toThrow(WorkflowWaitEventNotEligibleError);
  });
});

describe("observe semantics", () => {
  it("lets one event resolve two independent waits", () => {
    const waitA = eventWait();
    const waitB = armWorkflowWait({
      workspaceId,
      workflowRunId: "wr-2" as WorkflowRunId,
      workflowNodeRunId: "wnr-2" as WorkflowNodeRunId,
      workflowRunCreatedAt: runCreated,
      armedAt,
      nodeInput: {},
      wait: {
        kind: "EVENT",
        source: "payments",
        eventType: "payment.completed",
        correlation: { kind: "LITERAL", value: "ord-1" },
      },
    });
    const shared = event("we-shared", new Date("2026-01-01T10:01:00.000Z"));
    const resolvedA = waitA.resolveEvent(shared, armedAt);
    const resolvedB = waitB.resolveEvent(shared, armedAt);
    expect(resolvedA.resolvedByEventId).toBe("we-shared");
    expect(resolvedB.resolvedByEventId).toBe("we-shared");
    expect(shared.receivedAt.toISOString()).toBe("2026-01-01T10:01:00.000Z");
  });
});
