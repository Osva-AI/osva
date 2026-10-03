import { describe, expect, it, vi } from "vitest";

import {
  DemoOperatorMutationError,
  executeApprovalMutation,
  executeDeliveryEventMutation,
  parseApprovalMutationBody,
} from "../demo/operator-mutations.js";
import { validWorkflowInput } from "./fixtures.js";
import type { OperatorApi } from "../scripts/lib/operator-client.js";

describe("parseApprovalMutationBody", () => {
  it("accepts canonical approve/reject payloads", () => {
    expect(
      parseApprovalMutationBody({
        approvalId: "apr-1",
        decision: "APPROVED",
        comment: "Looks good.",
      }),
    ).toEqual({
      approvalId: "apr-1",
      decision: "APPROVED",
      comment: "Looks good.",
    });
  });

  it("rejects invalid approval ids and decisions", () => {
    expect(
      parseApprovalMutationBody({ approvalId: "", decision: "APPROVED" }),
    ).toBeInstanceOf(DemoOperatorMutationError);
    expect(
      parseApprovalMutationBody({ approvalId: "apr-1", decision: "MAYBE" }),
    ).toBeInstanceOf(DemoOperatorMutationError);
    expect(
      parseApprovalMutationBody({
        approvalId: "apr-1",
        decision: "APPROVED",
        comment: "",
      }),
    ).toBeInstanceOf(DemoOperatorMutationError);
  });
});

describe("executeApprovalMutation", () => {
  it("proxies decide for the pending approval id", async () => {
    const decide = vi.fn(async () => ({
      id: "apr-1",
      status: "APPROVED",
    }));
    const api = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => ({
            id: "wfr-1",
            status: "WAITING",
            input: validWorkflowInput,
            approvalRequests: [
              {
                id: "apr-1",
                workflowRunId: "wfr-1",
                status: "PENDING",
              },
            ],
            nodeRuns: [],
          })),
        },
        approvals: { decide },
      },
    } as unknown as OperatorApi;

    const result = await executeApprovalMutation(api, "wfr-1" as never, {
      approvalId: "apr-1",
      decision: "APPROVED",
    });
    expect(result.status).toBe("APPROVED");
    expect(decide).toHaveBeenCalledWith("apr-1", { decision: "APPROVED" });
  });

  it("rejects mismatched approval ids without calling decide", async () => {
    const decide = vi.fn();
    const api = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => ({
            id: "wfr-1",
            status: "WAITING",
            approvalRequests: [
              {
                id: "apr-1",
                workflowRunId: "wfr-1",
                status: "PENDING",
              },
            ],
            nodeRuns: [],
          })),
        },
        approvals: { decide },
      },
    } as unknown as OperatorApi;

    await expect(
      executeApprovalMutation(api, "wfr-1" as never, {
        approvalId: "apr-wrong",
        decision: "APPROVED",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(decide).not.toHaveBeenCalled();
  });
});

describe("executeDeliveryEventMutation", () => {
  it("emits only the canonical delivery event body", async () => {
    const ingestWorkflowEvent = vi.fn(async () => ({
      id: "wev-1",
      source: "canonical-demo",
      eventType: "report.delivery_requested",
    }));
    const api = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => ({
            id: "wfr-1",
            status: "WAITING",
            input: validWorkflowInput,
            nodeRuns: [
              {
                workflowNodeKey: "delivery-wait",
                status: "WAITING",
              },
            ],
            approvalRequests: [],
          })),
        },
      },
      ingestWorkflowEvent,
    } as unknown as OperatorApi;

    const result = await executeDeliveryEventMutation(api, "wfr-1" as never);
    expect(result.eventType).toBe("report.delivery_requested");
    expect(result.source).toBe("canonical-demo");
    expect(ingestWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "canonical-demo",
        eventType: "report.delivery_requested",
        correlationKey: validWorkflowInput.request.requestId,
        idempotencyKey: expect.stringContaining(
          validWorkflowInput.request.requestId,
        ),
      }),
    );
  });

  it("refuses delivery emission when the wait node is not WAITING", async () => {
    const ingestWorkflowEvent = vi.fn();
    const api = {
      sdk: {
        workflowRuns: {
          get: vi.fn(async () => ({
            id: "wfr-1",
            status: "WAITING",
            input: validWorkflowInput,
            nodeRuns: [
              {
                workflowNodeKey: "delivery-wait",
                status: "PENDING",
              },
            ],
            approvalRequests: [],
          })),
        },
      },
      ingestWorkflowEvent,
    } as unknown as OperatorApi;

    await expect(
      executeDeliveryEventMutation(api, "wfr-1" as never),
    ).rejects.toMatchObject({ status: 409 });
    expect(ingestWorkflowEvent).not.toHaveBeenCalled();
  });
});
