import type { WorkflowNodeRunId } from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { armWorkflowWait, WorkflowNodeRun } from "@osva/domain";

import { seedWorkspaceBFixtures } from "./seed-workspace-b-fixtures.js";
import { TEST_NOW } from "./test-web.js";
import {
  WS_A,
  WS_B,
  closeServers,
  createTwoWorkspaceHarness,
  fetchV1,
} from "./two-workspace-harness.js";

const EVENT_SOURCE = "billing";
const EVENT_TYPE = "invoice.paid";
const CORRELATION_KEY = "cross-tenant-order-42";

describe("POST /v1/workflow-events workspace isolation", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await closeServers(servers);
  });

  it("does not resolve or advance another workspace's EVENT wait", async () => {
    const harness = await createTwoWorkspaceHarness(servers);
    const b = await seedWorkspaceBFixtures(harness.ctx);

    const workflowNodeRunId = "node-wait-b-event" as WorkflowNodeRunId;
    await harness.ctx.workflowRuns.saveWorkflowNodeRun(
      WorkflowNodeRun.rehydrate({
        id: workflowNodeRunId,
        workspaceId: WS_B,
        workflowRunId: b.workflowRunId,
        workflowNodeKey: "wait-external",
        sequence: 1,
        status: "WAITING",
        input: { orderId: CORRELATION_KEY },
        startedAt: TEST_NOW,
        createdAt: TEST_NOW,
        updatedAt: TEST_NOW,
      }),
    );

    const armedAt = TEST_NOW;
    await harness.ctx.workflowWaits.saveWorkflowWait(
      armWorkflowWait({
        workspaceId: WS_B,
        workflowRunId: b.workflowRunId,
        workflowNodeRunId,
        workflowRunCreatedAt: TEST_NOW,
        armedAt,
        nodeInput: { orderId: CORRELATION_KEY },
        wait: {
          kind: "EVENT",
          source: EVENT_SOURCE,
          eventType: EVENT_TYPE,
          correlation: { kind: "LITERAL", value: CORRELATION_KEY },
        },
      }),
    );

    const waitBefore =
      await harness.ctx.workflowWaits.findWorkflowWaitByWorkflowNodeRunId(
        workflowNodeRunId,
      );
    const runBefore = await harness.ctx.workflowRuns.findWorkflowRunById(
      b.workflowRunId,
    );
    expect(waitBefore?.resolution).toBeUndefined();
    expect(runBefore?.status).toBe("RUNNING");

    const response = await fetchV1(`${harness.origin}/v1/workflow-events`, {
      method: "POST",
      headers: harness.authA,
      body: {
        source: EVENT_SOURCE,
        eventType: EVENT_TYPE,
        correlationKey: CORRELATION_KEY,
        idempotencyKey: "workspace-a-ingest-1",
        payload: { attempt: "cross-tenant" },
      },
    });

    expect(response.status).toBe(200);
    expect((response.body as { workspaceId: string }).workspaceId).toBe(WS_A);

    const waitAfter =
      await harness.ctx.workflowWaits.findWorkflowWaitByWorkflowNodeRunId(
        workflowNodeRunId,
      );
    const runAfter = await harness.ctx.workflowRuns.findWorkflowRunById(
      b.workflowRunId,
    );
    const nodeAfter =
      await harness.ctx.workflowRuns.findWorkflowNodeRunById(workflowNodeRunId);

    expect(waitAfter?.resolution).toBeUndefined();
    expect(waitAfter?.resolvedByEventId).toBeUndefined();
    expect(runAfter?.status).toBe(runBefore?.status);
    expect(nodeAfter?.status).toBe("WAITING");
  });
});
