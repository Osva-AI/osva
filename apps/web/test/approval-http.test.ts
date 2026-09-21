import { afterEach, describe, expect, it } from "vitest";
import type {
  ApprovalRequestId,
  WorkflowNodeRunId,
  WorkspaceId,
} from "@osva/contracts";
import { ApprovalRequest, WorkflowNodeRun } from "@osva/domain";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { fetchJson, setTestAuthHeaders } from "./http-test-helpers.js";
import { TEST_NOW, createTestWebApplication } from "./test-web.js";

const WORKSPACE_ID = "ws-1" as WorkspaceId;

describe("ApprovalRequest HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("inspects and decides a workspace-scoped ApprovalRequest without advancing the workflow", async () => {
    const { origin, workflowRuns, approvalRequests } = await listen();
    const created = await createPendingWorkflowRun(origin);
    const workflowRunId = created.id;
    const nodeRun = WorkflowNodeRun.create({
      id: "node-run-review" as WorkflowNodeRunId,
      workspaceId: WORKSPACE_ID,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: { campaign: "launch" },
      createdAt: TEST_NOW,
    }).markWaiting(TEST_NOW);
    await workflowRuns.saveWorkflowNodeRun(nodeRun);
    const pending = ApprovalRequest.create({
      id: "approval-1" as ApprovalRequestId,
      workspaceId: WORKSPACE_ID,
      workflowRunId,
      workflowNodeRunId: nodeRun.id,
      createdAt: TEST_NOW,
    });
    await approvalRequests.saveApprovalRequest(pending);

    const loaded = await fetchJson(
      `${origin}/v1/approval-requests/${pending.id}`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body).toMatchObject({
      id: pending.id,
      status: "PENDING",
      workflowRunId,
    });

    const wrongWorkspace = await fetchJson(
      `${origin}/v1/approval-requests/${pending.id}/decision`,
      {
        method: "POST",
        body: { decision: "DEFERRED" },
      },
    );
    expect(wrongWorkspace.status).toBe(400);

    const invalid = await fetchJson(
      `${origin}/v1/approval-requests/${pending.id}/decision`,
      {
        method: "POST",
        body: { decision: "DEFERRED" },
      },
    );
    expect(invalid.status).toBe(400);

    const decided = await fetchJson(
      `${origin}/v1/approval-requests/${pending.id}/decision`,
      {
        method: "POST",
        body: {
          decision: "APPROVED",
          comment: "Looks good.",
        },
      },
    );
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({
      status: "APPROVED",
      decisionComment: "Looks good.",
    });

    const repeated = await fetchJson(
      `${origin}/v1/approval-requests/${pending.id}/decision`,
      {
        method: "POST",
        body: { decision: "APPROVED" },
      },
    );
    expect(repeated.status).toBe(200);
    expect(repeated.body).toEqual(decided.body);

    const conflict = await fetchJson(
      `${origin}/v1/approval-requests/${pending.id}/decision`,
      {
        method: "POST",
        body: { decision: "REJECTED" },
      },
    );
    expect(conflict.status).toBe(409);

    const workflowView = await fetchJson(
      `${origin}/v1/workflow-runs/${workflowRunId}`,
    );
    expect(workflowView.status).toBe(200);
    expect(workflowView.body).toMatchObject({
      status: "PENDING",
      approvalRequests: [
        expect.objectContaining({
          id: pending.id,
          status: "APPROVED",
        }),
      ],
    });
  });

  async function listen() {
    const created = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(created.server);
    const port = await listenHttpServer(created.server, "127.0.0.1", 0);
    setTestAuthHeaders(created.testApiKey);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      workflowRuns: created.workflowRuns,
      approvalRequests: created.approvalRequests,
    };
  }
});

async function createPendingWorkflowRun(origin: string): Promise<{
  readonly id: import("@osva/contracts").WorkflowRunId;
}> {
  const workflow = await fetchJson(`${origin}/v1/workflows`, {
    method: "POST",
    body: {
      key: "campaign",
      name: "Campaign",
    },
  });
  const workflowId = (workflow.body as { id: string }).id;
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      key: "example-agent",
      name: "Example Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "example-agent",
        name: "Example Agent",
        runtime: { type: "BUILTIN_PACKAGE", key: "example-agent" },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 30_000, maxAttempts: 2 },
        capabilities: { model: false, tools: [] },
      },
    },
  });
  const agentVersionId = (version.body as { id: string }).id;
  const workflowVersion = await fetchJson(
    `${origin}/v1/workflows/${workflowId}/versions`,
    {
      method: "POST",
      body: {
        definition: {
          schemaVersion: "2",
          nodes: [
            { key: "research", type: "AGENT", agentVersionId },
            { key: "review", type: "APPROVAL", title: "Approve launch" },
            { key: "publish", type: "AGENT", agentVersionId },
          ],
          edges: [
            { from: "research", to: "review" },
            { from: "review", to: "publish" },
          ],
        },
      },
    },
  );
  const created = await fetchJson(`${origin}/v1/workflow-runs`, {
    method: "POST",
    body: {
      workflowVersionId: (workflowVersion.body as { id: string }).id,
      input: { campaign: "launch" },
    },
  });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    approvalRequests: [],
  });
  return {
    id: (created.body as { id: import("@osva/contracts").WorkflowRunId }).id,
  };
}
