import type { ApiKeyId, RunAttemptId, WorkspaceId } from "@osva-ai/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva-ai/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import {
  authHeadersForKey,
  fetchJson,
  setTestAuthHeaders,
} from "./http-test-helpers.js";
import {
  TEST_NOW,
  createTestWebApplication,
  seedTestApiKey,
} from "./test-web.js";

const OTHER_WORKSPACE = "ws-other" as WorkspaceId;

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

describe("RunAttempt execution diagnostics HTTP", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  async function listen() {
    const harness = await createTestWebApplication();
    servers.push(harness.server);
    const port = await listenHttpServer(harness.server, "127.0.0.1", 0);
    setTestAuthHeaders(harness.testApiKey);
    return { origin: `http://127.0.0.1:${String(port)}`, ...harness };
  }

  it("returns queued diagnostics for a newly created attempt", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered);

    const loaded = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/attempts/${created.runAttempt.id}`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body).toMatchObject({
      id: created.runAttempt.id,
      status: "PENDING",
      execution: {
        state: "queued",
        leased: false,
        executionGeneration: 0,
        interrupted: false,
        observedAt: TEST_NOW.toISOString(),
      },
    });
    expect(JSON.stringify(loaded.body)).not.toContain("executionOwner");
  });

  it("exposes the same sanitized diagnostics to VIEWER, OPERATOR, EDITOR, and ADMIN", async () => {
    const { origin, apiKeys, runs, workspaceId } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered);
    const attempt = await runs.findRunAttemptById(
      created.runAttempt.id as RunAttemptId,
    );
    if (attempt === null) {
      throw new Error("expected persisted attempt");
    }
    const leased = attempt
      .transitionTo("RUNNING", TEST_NOW)
      .withExecutionLease({
        owner: "worker-secret",
        generation: 3,
        expiresAt: new Date(TEST_NOW.getTime() + 30_000),
      });
    await runs.transitionRunAttempt(attempt.status, leased);

    for (const [role, apiKeyId] of [
      [COMMUNITY_EDITION_ROLES.VIEWER, "ak-diag-viewer"],
      [COMMUNITY_EDITION_ROLES.OPERATOR, "ak-diag-operator"],
      [COMMUNITY_EDITION_ROLES.EDITOR, "ak-diag-editor"],
      [COMMUNITY_EDITION_ROLES.ADMIN, "ak-diag-admin"],
    ] as const) {
      const key = await seedTestApiKey({
        apiKeys,
        workspaceId,
        role,
        apiKeyId: apiKeyId as ApiKeyId,
      });
      const loaded = await fetchJson(
        `${origin}/v1/runs/${created.run.id}/attempts/${created.runAttempt.id}`,
        { headers: authHeadersForKey(key) },
      );
      expect(loaded.status).toBe(200);
      expect(loaded.body).toMatchObject({
        execution: {
          state: "running_leased",
          leased: true,
          executionGeneration: 3,
          interrupted: false,
        },
      });
      expect(JSON.stringify(loaded.body)).not.toContain("worker-secret");
    }
  });

  it("keeps foreign-workspace attempt diagnostics inaccessible", async () => {
    const { origin, apiKeys } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered);
    const foreign = await seedTestApiKey({
      apiKeys,
      workspaceId: OTHER_WORKSPACE,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      apiKeyId: "ak-foreign-diag" as ApiKeyId,
    });

    const loaded = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/attempts/${created.runAttempt.id}`,
      { headers: authHeadersForKey(foreign) },
    );
    expect(loaded.status).toBe(404);
    expect(JSON.stringify(loaded.body)).not.toContain("execution");
  });

  it("describes interrupted and completed attempts without leaking owner metadata", async () => {
    const { origin, runs } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered);
    const attempt = await runs.findRunAttemptById(
      created.runAttempt.id as RunAttemptId,
    );
    if (attempt === null) {
      throw new Error("expected persisted attempt");
    }

    const running = attempt
      .transitionTo("RUNNING", TEST_NOW)
      .withExecutionLease({
        owner: "worker-secret",
        generation: 1,
        expiresAt: TEST_NOW,
      });
    await runs.transitionRunAttempt(attempt.status, running);
    const interrupted = running.transitionTo("FAILED", TEST_NOW, {
      error: {
        code: "EXECUTION_INTERRUPTED",
        message: "Execution lease expired; worker ownership was lost.",
      },
      infrastructureMetadata: {
        recovery: { reason: "LEASE_EXPIRED", owner: "worker-secret" },
      },
    });
    await runs.transitionRunAttempt("RUNNING", interrupted);

    const loaded = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/attempts/${created.runAttempt.id}`,
    );
    expect(loaded.body).toMatchObject({
      status: "FAILED",
      execution: {
        state: "interrupted",
        interrupted: true,
        recoveryReason: "LEASE_EXPIRED",
      },
    });
    expect(JSON.stringify(loaded.body)).not.toContain("worker-secret");
  });
});

async function registerAgent(
  origin: string,
): Promise<{ agentId: string; agentVersionId: string }> {
  const created = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: { key: "example-agent", name: "Example Agent" },
  });
  const agentId = (created.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: { manifest: VALID_MANIFEST },
  });
  return {
    agentId,
    agentVersionId: (version.body as { id: string }).id,
  };
}

async function createRun(
  origin: string,
  registered: { readonly agentId: string; readonly agentVersionId: string },
) {
  const created = await fetchJson(`${origin}/v1/runs`, {
    method: "POST",
    body: {
      agentId: registered.agentId,
      agentVersionId: registered.agentVersionId,
      input: { prompt: "diag" },
    },
  });
  return created.body as {
    run: { id: string };
    runAttempt: { id: string };
  };
}
