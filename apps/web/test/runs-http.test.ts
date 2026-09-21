import type { AgentId, WorkspaceId } from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { encodeRunListCursor } from "../src/run-cursor.js";
import { closeHttpServer, listenHttpServer } from "../src/server.js";
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

describe("Run HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("creates a Run through the HTTP API using a registered AgentVersion", async () => {
    const { origin, queue } = await listen();
    const registered = await registerAgent(origin);

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId: registered.agentId,
        agentVersionId: registered.agentVersionId,
        input: { prompt: "hello" },
      },
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      run: {
        id: "id-3",
        agentId: registered.agentId,
        status: "QUEUED",
        effectiveBindings: {
          agentVersionId: registered.agentVersionId,
          modelProfileVersionBindings: {},
          toolVersionBindings: {},
        },
        input: { prompt: "hello" },
        createdAt: TEST_NOW.toISOString(),
      },
      runAttempt: {
        id: "id-4",
        runId: "id-3",
        sequence: 1,
        status: "PENDING",
      },
    });
    expect(queue.pendingRunAttemptIds()).toEqual(["id-4"]);

    const loaded = await fetchJson(`${origin}/v1/runs/id-3`);
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual((created.body as { run: unknown }).run);
  });

  it("rejects a client-authored effectiveBindings object", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId: registered.agentId,
        agentVersionId: registered.agentVersionId,
        effectiveBindings: {
          agentVersionId: registered.agentVersionId,
          modelProfileVersionBindings: {
            default: "model-profile-version-1",
          },
        },
        input: { prompt: "hello" },
      },
    });

    expect(created.status).toBe(400);
    expect(created.body).toEqual({ status: "invalid_request" });
  });

  it("rejects CreateRun when the AgentVersion belongs to another Agent", async () => {
    const { origin, queue } = await listen();
    await registerAgent(origin, { key: "first-agent" });
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "second-agent",
        name: "Second Agent",
      },
    });
    await fetchJson(`${origin}/v1/agents/id-3/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId: "id-1",
        agentVersionId: "id-4",
        input: { prompt: "hello" },
      },
    });

    expect(created.status).toBe(400);
    expect(created.body).toEqual({ status: "invalid_request" });
    expect(queue.pendingRunAttemptIds()).toEqual([]);
    expect((await fetchJson(`${origin}/v1/runs/id-5`)).status).toBe(404);
  });

  it("returns not_found for a missing Run", async () => {
    const { origin } = await listen();
    const response = await fetchJson(`${origin}/v1/runs/missing`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      status: "error",
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("lists Runs with deterministic ordering and cursor pagination", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);

    const first = await createRun(origin, registered, { prompt: "a" });
    const second = await createRun(origin, registered, { prompt: "b" });
    const third = await createRun(origin, registered, { prompt: "c" });

    const page1 = await fetchJson(`${origin}/v1/runs?limit=2`);
    expect(page1.status).toBe(200);
    const page1Body = page1.body as {
      runs: Array<{ id: string; input: { prompt: string } }>;
      nextCursor: string;
    };
    expect(page1Body.runs.map((run) => run.id)).toEqual([
      third.run.id,
      second.run.id,
    ]);
    expect(page1Body.nextCursor).toEqual(expect.any(String));

    const page2 = await fetchJson(
      `${origin}/v1/runs?limit=2&cursor=${encodeURIComponent(page1Body.nextCursor)}`,
    );
    expect(page2.status).toBe(200);
    const page2Body = page2.body as {
      runs: Array<{ id: string }>;
      nextCursor?: string;
    };
    expect(page2Body.runs.map((run) => run.id)).toEqual([first.run.id]);
    expect(page2Body.nextCursor).toBeUndefined();
  });

  it("tie-breaks Run list pages by id when createdAt matches", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    await createRun(origin, registered, { n: 1 });
    await createRun(origin, registered, { n: 2 });
    await createRun(origin, registered, { n: 3 });

    const listed = await fetchJson(`${origin}/v1/runs?limit=2`);
    const body = listed.body as {
      runs: Array<{ id: string }>;
      nextCursor: string;
    };
    expect(body.runs.map((run) => run.id)).toEqual(["id-7", "id-5"]);

    const next = await fetchJson(
      `${origin}/v1/runs?limit=2&cursor=${encodeURIComponent(body.nextCursor)}`,
    );
    expect(
      (next.body as { runs: Array<{ id: string }> }).runs.map((run) => run.id),
    ).toEqual(["id-3"]);
  });

  it("filters Runs by agentId, agentVersionId, and status", async () => {
    const { origin } = await listen();
    const first = await registerAgent(origin, { key: "one" });
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "two",
        name: "Second Agent",
      },
    });
    const secondVersion = await fetchJson(`${origin}/v1/agents/id-3/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });
    const second = {
      agentId: "id-3" as AgentId,
      agentVersionId: (secondVersion.body as { id: string }).id,
    };

    await createRun(origin, first, { from: "one" });
    await createRun(origin, second, { from: "two" });

    const byAgent = await fetchJson(
      `${origin}/v1/runs?agentId=${first.agentId}`,
    );
    expect(
      (byAgent.body as { runs: Array<{ agentId: string }> }).runs.every(
        (run) => run.agentId === first.agentId,
      ),
    ).toBe(true);
    expect((byAgent.body as { runs: unknown[] }).runs).toHaveLength(1);

    const byVersion = await fetchJson(
      `${origin}/v1/runs?agentVersionId=${second.agentVersionId}`,
    );
    expect(
      (
        byVersion.body as {
          runs: Array<{ effectiveBindings: { agentVersionId: string } }>;
        }
      ).runs.map((run) => run.effectiveBindings.agentVersionId),
    ).toEqual([second.agentVersionId]);

    const byStatus = await fetchJson(`${origin}/v1/runs?status=QUEUED`);
    expect(
      (byStatus.body as { runs: Array<{ status: string }> }).runs.every(
        (run) => run.status === "QUEUED",
      ),
    ).toBe(true);
  });

  it("rejects invalid Run list limits and cursors", async () => {
    const { origin } = await listen();
    expect((await fetchJson(`${origin}/v1/runs?limit=0`)).status).toBe(400);
    expect((await fetchJson(`${origin}/v1/runs?limit=101`)).status).toBe(400);
    expect((await fetchJson(`${origin}/v1/runs?limit=abc`)).status).toBe(400);
    expect(
      (await fetchJson(`${origin}/v1/runs?cursor=not-a-cursor`)).status,
    ).toBe(400);
    expect(
      (await fetchJson(`${origin}/v1/runs?status=NOT_A_STATUS`)).status,
    ).toBe(400);
    expect(
      (
        await fetchJson(
          `${origin}/v1/runs?cursor=${encodeURIComponent(encodeRunListCursor({ createdAt: "nope", id: "run-1" }))}`,
        )
      ).status,
    ).toBe(400);
  });

  it("lists and loads RunAttempts nested under the owning Run", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered, { prompt: "nested" });

    const listed = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/attempts`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      attempts: [created.runAttempt],
    });

    const loaded = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/attempts/${created.runAttempt.id}`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(created.runAttempt);
  });

  it("does not leak a RunAttempt through another Run nested route", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    const first = await createRun(origin, registered, { n: 1 });
    const second = await createRun(origin, registered, { n: 2 });

    const leaked = await fetchJson(
      `${origin}/v1/runs/${first.run.id}/attempts/${second.runAttempt.id}`,
    );
    expect(leaked.status).toBe(404);
    expect(leaked.body).toMatchObject({
      status: "error",
      code: "RESOURCE_NOT_FOUND",
    });

    const missingRun = await fetchJson(`${origin}/v1/runs/missing/attempts`);
    expect(missingRun.status).toBe(404);
  });

  it("does not expose Run mutation endpoints", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered, {
      prompt: "immutable",
    });

    expect(
      (
        await fetchJson(`${origin}/v1/runs/${created.run.id}`, {
          method: "PATCH",
          body: { status: "CANCELLED" },
        })
      ).status,
    ).toBe(405);
    expect(
      (
        await fetchJson(`${origin}/v1/runs/${created.run.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(405);
    expect(
      (
        await fetchJson(`${origin}/v1/runs/${created.run.id}/attempts`, {
          method: "POST",
          body: {},
        })
      ).status,
    ).toBe(405);
  });

  it("rejects client-controlled Run identity fields", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        id: "chosen-run",
        runAttemptId: "chosen-attempt",
        status: "SUCCEEDED",
        agentId: registered.agentId,
        agentVersionId: registered.agentVersionId,
        input: { prompt: "hello" },
      },
    });
    expect(created.status).toBe(400);
    expect(created.body).toEqual({ status: "invalid_request" });
  });

  async function listen() {
    const { server, queue, testApiKey } = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(server);
    const port = await listenHttpServer(server, "127.0.0.1", 0);
    setTestAuthHeaders(testApiKey);
    return { origin: `http://127.0.0.1:${String(port)}`, queue };
  }
});

async function registerAgent(
  origin: string,
  options?: { readonly key?: string },
): Promise<{ agentId: string; agentVersionId: string }> {
  const created = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      key: options?.key ?? "example-agent",
      name: "Example Agent",
    },
  });
  expect(created.status).toBe(201);
  const agentId = (created.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: { manifest: VALID_MANIFEST },
  });
  expect(version.status).toBe(201);
  return {
    agentId,
    agentVersionId: (version.body as { id: string }).id,
  };
}

async function createRun(
  origin: string,
  registered: { readonly agentId: string; readonly agentVersionId: string },
  input: unknown,
): Promise<{
  run: { id: string };
  runAttempt: { id: string };
}> {
  const created = await fetchJson(`${origin}/v1/runs`, {
    method: "POST",
    body: {
      agentId: registered.agentId,
      agentVersionId: registered.agentVersionId,
      input,
    },
  });
  expect(created.status).toBe(201);
  return created.body as {
    run: { id: string };
    runAttempt: { id: string };
  };
}
