import { afterEach, describe, expect, it } from "vitest";
import type { AgentVersionId, WorkspaceId } from "@osva/contracts";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
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

describe("Workflow Registry HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("creates, reads, and lists Workflows and immutable WorkflowVersions", async () => {
    const { origin, agentVersionId } = await listenWithAgent();

    const created = await fetchJson(`${origin}/v1/workflows`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "research-report",
        name: "Research Report",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      key: "research-report",
      name: "Research Report",
      createdAt: TEST_NOW.toISOString(),
    });

    const workflowId = (created.body as { id: string }).id;
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
    expect(version.status).toBe(201);
    expect(version.body).toMatchObject({
      workflowId,
      version: 1,
    });

    const listed = await fetchJson(`${origin}/v1/workflows`);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ workflows: [created.body] });

    const versions = await fetchJson(
      `${origin}/v1/workflows/${workflowId}/versions`,
    );
    expect(versions.status).toBe(200);
    expect(versions.body).toEqual({ versions: [version.body] });
  });

  it("rejects duplicate node keys and branching at version creation", async () => {
    const { origin, agentVersionId } = await listenWithAgent();
    const workflow = await fetchJson(`${origin}/v1/workflows`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "research-report",
        name: "Research Report",
      },
    });
    const workflowId = (workflow.body as { id: string }).id;

    const duplicate = await fetchJson(
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
    expect(duplicate.status).toBe(400);

    const branch = await fetchJson(
      `${origin}/v1/workflows/${workflowId}/versions`,
      {
        method: "POST",
        body: {
          definition: {
            schemaVersion: "1",
            nodes: [
              { key: "a", type: "AGENT", agentVersionId },
              { key: "b", type: "AGENT", agentVersionId },
              { key: "c", type: "AGENT", agentVersionId },
            ],
            edges: [
              { from: "a", to: "b" },
              { from: "a", to: "c" },
            ],
          },
        },
      },
    );
    expect(branch.status).toBe(400);
  });

  it("rejects unknown AgentVersion bindings", async () => {
    const { origin } = await listenWithAgent();
    const workflow = await fetchJson(`${origin}/v1/workflows`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "research-report",
        name: "Research Report",
      },
    });
    const workflowId = (workflow.body as { id: string }).id;
    const response = await fetchJson(
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
                agentVersionId: "missing-agent-version",
              },
            ],
            edges: [],
          },
        },
      },
    );
    expect(response.status).toBe(404);
  });

  it("creates a PENDING WorkflowRun without enqueueing agent work", async () => {
    const { origin, agentVersionId, queue } = await listenWithAgent();
    const workflow = await fetchJson(`${origin}/v1/workflows`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "research-report",
        name: "Research Report",
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
    const workflowVersionId = (version.body as { id: string }).id;

    const created = await fetchJson(`${origin}/v1/workflow-runs`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        workflowVersionId,
        input: { topic: "osva" },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: "PENDING",
      workflowVersionId,
      input: { topic: "osva" },
      nodeRuns: [],
    });
    expect(queue.pendingRunAttemptIds()).toEqual([]);

    const loaded = await fetchJson(
      `${origin}/v1/workflow-runs/${String((created.body as { id: string }).id)}`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(created.body);
  });

  it("rejects WorkflowVersion mutation methods", async () => {
    const { origin, agentVersionId } = await listenWithAgent();
    const workflow = await fetchJson(`${origin}/v1/workflows`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "research-report",
        name: "Research Report",
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

    const patched = await fetch(
      `${origin}/v1/workflows/${workflowId}/versions/${String((version.body as { id: string }).id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ definition: version.body }),
      },
    );
    expect(patched.status).toBe(405);
    expect(await patched.json()).toEqual({ status: "method_not_allowed" });
  });

  async function listenWithAgent() {
    const { server, agents, queue } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
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
      queue,
      agents,
      agentVersionId: (created.body as { id: string }).id as AgentVersionId,
    };
  }
});

async function fetchJson(
  url: string,
  options?: { readonly method?: string; readonly body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: options?.method ?? "GET",
    headers:
      options?.body === undefined
        ? undefined
        : { "content-type": "application/json" },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}
