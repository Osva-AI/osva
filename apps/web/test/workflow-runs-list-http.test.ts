import { afterEach, describe, expect, it } from "vitest";
import type { AgentVersionId, WorkspaceId } from "@osva-ai/contracts";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import { encodeWorkflowRunListCursor } from "../src/workflow-run-cursor.js";
import { fetchJson, setTestAuthHeaders } from "./http-test-helpers.js";
import { TEST_NOW, createTestWebApplication } from "./test-web.js";

const WORKSPACE_ID = "ws-1" as WorkspaceId;

const VALID_MANIFEST = {
  schemaVersion: "1",
  key: "example-agent",
  name: "Example Agent",
  runtime: {
    type: "BUILTIN_PACKAGE",
    key: "example-agent",
  },
  input: { schema: {} },
  output: { schema: {} },
  execution: { timeoutMs: 30_000, maxAttempts: 2 },
  capabilities: { model: false, tools: [] },
};

describe("WorkflowRun list HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("lists WorkflowRuns with summary fields, ordering, and cursor pagination", async () => {
    const { origin, agentVersionId } = await listenWithAgent();
    const { workflowId, workflowVersionId } = await createWorkflowWithVersion(
      origin,
      agentVersionId,
    );

    const first = await createWorkflowRun(origin, workflowVersionId, {
      topic: "a",
    });
    const second = await createWorkflowRun(origin, workflowVersionId, {
      topic: "b",
    });
    const third = await createWorkflowRun(origin, workflowVersionId, {
      topic: "c",
    });

    const page1 = await fetchJson(`${origin}/v1/workflow-runs?limit=2`);
    expect(page1.status).toBe(200);
    const page1Body = page1.body as {
      workflowRuns: Array<{
        id: string;
        workflowId: string;
        workflowVersionId: string;
        status: string;
        input?: unknown;
        nodeRuns?: unknown;
      }>;
      nextCursor: string;
    };
    expect(page1Body.workflowRuns.map((run) => run.id)).toEqual([
      third.id,
      second.id,
    ]);
    for (const run of page1Body.workflowRuns) {
      expect(run).toMatchObject({
        workflowId,
        workflowVersionId,
        status: "PENDING",
        createdAt: TEST_NOW.toISOString(),
      });
      expect(run).not.toHaveProperty("input");
      expect(run).not.toHaveProperty("nodeRuns");
    }
    expect(page1Body.nextCursor).toEqual(expect.any(String));

    const page2 = await fetchJson(
      `${origin}/v1/workflow-runs?limit=2&cursor=${encodeURIComponent(page1Body.nextCursor)}`,
    );
    expect(page2.status).toBe(200);
    const page2Body = page2.body as {
      workflowRuns: Array<{ id: string }>;
      nextCursor?: string;
    };
    expect(page2Body.workflowRuns.map((run) => run.id)).toEqual([first.id]);
    expect(page2Body.nextCursor).toBeUndefined();
  });

  it("filters WorkflowRuns by workflowId, workflowVersionId, and status", async () => {
    const { origin, agentVersionId } = await listenWithAgent();
    const firstWorkflow = await createWorkflowWithVersion(
      origin,
      agentVersionId,
      "one",
    );
    const secondWorkflow = await createWorkflowWithVersion(
      origin,
      agentVersionId,
      "two",
    );

    await createWorkflowRun(origin, firstWorkflow.workflowVersionId, {
      from: "one",
    });
    const secondRun = await createWorkflowRun(
      origin,
      secondWorkflow.workflowVersionId,
      { from: "two" },
    );

    const byWorkflow = await fetchJson(
      `${origin}/v1/workflow-runs?workflowId=${secondWorkflow.workflowId}`,
    );
    expect(byWorkflow.status).toBe(200);
    expect(
      (
        byWorkflow.body as { workflowRuns: Array<{ id: string }> }
      ).workflowRuns.map((run) => run.id),
    ).toEqual([secondRun.id]);

    const byVersion = await fetchJson(
      `${origin}/v1/workflow-runs?workflowVersionId=${secondWorkflow.workflowVersionId}`,
    );
    expect(
      (
        byVersion.body as {
          workflowRuns: Array<{ workflowVersionId: string }>;
        }
      ).workflowRuns.map((run) => run.workflowVersionId),
    ).toEqual([secondWorkflow.workflowVersionId]);

    const byStatus = await fetchJson(
      `${origin}/v1/workflow-runs?status=PENDING`,
    );
    expect(
      (
        byStatus.body as { workflowRuns: Array<{ status: string }> }
      ).workflowRuns.every((run) => run.status === "PENDING"),
    ).toBe(true);
  });

  it("rejects invalid WorkflowRun list limits, cursors, and status", async () => {
    const { origin } = await listenWithAgent();
    expect((await fetchJson(`${origin}/v1/workflow-runs?limit=0`)).status).toBe(
      400,
    );
    expect(
      (await fetchJson(`${origin}/v1/workflow-runs?limit=101`)).status,
    ).toBe(400);
    expect(
      (await fetchJson(`${origin}/v1/workflow-runs?limit=abc`)).status,
    ).toBe(400);
    expect(
      (await fetchJson(`${origin}/v1/workflow-runs?cursor=not-a-cursor`))
        .status,
    ).toBe(400);
    expect(
      (await fetchJson(`${origin}/v1/workflow-runs?status=NOT_A_STATUS`))
        .status,
    ).toBe(400);
    expect(
      (
        await fetchJson(
          `${origin}/v1/workflow-runs?cursor=${encodeURIComponent(
            encodeWorkflowRunListCursor({ createdAt: "nope", id: "wr-1" }),
          )}`,
        )
      ).status,
    ).toBe(400);
  });

  async function listenWithAgent() {
    const { server, testApiKey } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    setTestAuthHeaders(testApiKey);
    const origin = `http://127.0.0.1:${String(port)}`;
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "example-agent",
        name: "Example Agent",
      },
    });
    const created = await fetchJson(`${origin}/v1/agents/id-1/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });
    return {
      origin,
      agentVersionId: (created.body as { id: string }).id as AgentVersionId,
    };
  }

  async function createWorkflowWithVersion(
    origin: string,
    agentVersionId: AgentVersionId,
    key = "research-report",
  ) {
    const workflow = await fetchJson(`${origin}/v1/workflows`, {
      method: "POST",
      body: {
        key,
        name: key,
      },
    });
    const workflowId = (workflow.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/workflows/${workflowId}/versions`,
      {
        method: "POST",
        body: {
          definition: {
            schemaVersion: "1",
            nodes: [
              {
                key: "research",
                type: "AGENT",
                agentVersionId,
              },
            ],
            edges: [],
          },
        },
      },
    );
    return {
      workflowId,
      workflowVersionId: (version.body as { id: string }).id,
    };
  }

  async function createWorkflowRun(
    origin: string,
    workflowVersionId: string,
    input: Record<string, unknown>,
  ) {
    const created = await fetchJson(`${origin}/v1/workflow-runs`, {
      method: "POST",
      body: {
        workflowVersionId,
        input,
      },
    });
    expect(created.status).toBe(201);
    return created.body as { id: string };
  }
});
