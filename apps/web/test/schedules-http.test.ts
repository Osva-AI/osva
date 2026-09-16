import type { AgentId, WorkspaceId } from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";

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

describe("Schedule HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("creates, reads, lists, and updates schedules", async () => {
    const { origin } = await listen();
    const agent = await registerAgent(origin);

    const created = await fetchJson(`${origin}/v1/schedules`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "daily-report",
        name: "Daily Report",
        agentId: agent.agentId,
        agentVersionId: agent.agentVersionId,
        cronExpression: "* * * * *",
        timezone: "UTC",
        input: { prompt: "scheduled hello" },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "id-3",
      workspaceId: WORKSPACE_ID,
      key: "daily-report",
      name: "Daily Report",
      agentId: agent.agentId,
      agentVersionId: agent.agentVersionId,
      cronExpression: "* * * * *",
      timezone: "UTC",
      input: { prompt: "scheduled hello" },
      enabled: true,
      nextRunAt: "2026-01-15T12:01:00.000Z",
      createdAt: TEST_NOW.toISOString(),
      updatedAt: TEST_NOW.toISOString(),
    });

    const loaded = await fetchJson(`${origin}/v1/schedules/id-3`);
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(created.body);

    const listed = await fetchJson(
      `${origin}/v1/schedules?workspaceId=${WORKSPACE_ID}`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ schedules: [created.body] });

    const updated = await fetchJson(`${origin}/v1/schedules/id-3`, {
      method: "PATCH",
      body: {
        name: "Renamed Report",
        enabled: false,
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      id: "id-3",
      name: "Renamed Report",
      enabled: false,
      nextRunAt: null,
    });
  });

  it("lists schedule occurrences after materialization through the repository", async () => {
    const { origin, schedules } = await listen();
    const agent = await registerAgent(origin);

    const created = await fetchJson(`${origin}/v1/schedules`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "hourly-report",
        name: "Hourly Report",
        agentId: agent.agentId,
        agentVersionId: agent.agentVersionId,
        cronExpression: "* * * * *",
        timezone: "UTC",
        input: { prompt: "hourly" },
      },
    });
    const scheduleId = (created.body as { id: string }).id;

    await schedules.materializeDueOccurrences(
      new Date("2026-01-15T12:01:00.000Z"),
      10,
      () => "occ-1" as import("@osva/contracts").ScheduleOccurrenceId,
    );

    const listed = await fetchJson(
      `${origin}/v1/schedules/${scheduleId}/occurrences`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      occurrences: [
        {
          id: "occ-1",
          scheduleId,
          scheduledFor: "2026-01-15T12:01:00.000Z",
          agentVersionId: agent.agentVersionId,
          runId: null,
          createdAt: "2026-01-15T12:01:00.000Z",
          dispatchedAt: null,
        },
      ],
    });
  });

  it("returns not_found for an unknown schedule", async () => {
    const { origin } = await listen();
    const response = await fetchJson(`${origin}/v1/schedules/missing`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ status: "not_found" });
  });

  it("rejects invalid schedule requests", async () => {
    const { origin } = await listen();
    const agent = await registerAgent(origin);

    const invalidCron = await fetchJson(`${origin}/v1/schedules`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "bad-cron",
        name: "Bad Cron",
        agentId: agent.agentId,
        agentVersionId: agent.agentVersionId,
        cronExpression: "not-a-cron",
        timezone: "UTC",
        input: {},
      },
    });
    expect(invalidCron.status).toBe(400);
    expect(invalidCron.body).toEqual({ status: "invalid_request" });

    const invalidTimezone = await fetchJson(`${origin}/v1/schedules`, {
      method: "POST",
      body: {
        workspaceId: WORKSPACE_ID,
        key: "bad-timezone",
        name: "Bad Timezone",
        agentId: agent.agentId,
        agentVersionId: agent.agentVersionId,
        cronExpression: "* * * * *",
        timezone: "Not/A/Timezone",
        input: {},
      },
    });
    expect(invalidTimezone.status).toBe(400);
    expect(invalidTimezone.body).toEqual({ status: "invalid_request" });
  });

  async function listen() {
    const context = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(context.server);
    const port = await listenHttpServer(context.server, "127.0.0.1", 0);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      schedules: context.schedules,
    };
  }
});

async function registerAgent(origin: string): Promise<{
  readonly agentId: AgentId;
  readonly agentVersionId: string;
}> {
  const created = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: "example-agent",
      name: "Example Agent",
    },
  });
  const agentId = (created.body as { id: AgentId }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: { manifest: VALID_MANIFEST },
  });
  return {
    agentId,
    agentVersionId: (version.body as { id: string }).id,
  };
}

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
