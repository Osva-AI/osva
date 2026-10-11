import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import type { ConsoleConfig } from "../src/server/config.js";
import type { ConsoleOsvaClient } from "../src/server/osva-client.js";
import { createConsoleServer } from "../src/server/server.js";

const testConfig: ConsoleConfig = {
  osvaBaseUrl: "http://127.0.0.1:3000",
  osvaApiKey: "super-secret-console-key",
  host: "127.0.0.1",
  port: 4174,
  clientDistDir: "/tmp/unused",
};

function createMockClient(
  overrides: Partial<ConsoleOsvaClient> = {},
): ConsoleOsvaClient {
  return {
    getAuthContext: async () => ({
      data: {
        subjectId: "subject-1",
        workspaceId: "workspace-1",
        role: "admin",
      },
      requestId: "req-auth-success",
    }),
    listRuns: async () => ({ data: { runs: [] } }),
    getRun: async () => {
      throw new Error("not implemented");
    },
    listAttempts: async () => ({ data: { attempts: [] } }),
    getAttempt: async () => {
      throw new Error("not implemented");
    },
    listAllSteps: async () => ({ data: { steps: [] } }),
    getStep: async () => {
      throw new Error("not implemented");
    },
    getUsage: async () => ({
      data: {
        modelCalls: 0,
        toolCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        estimatedCostUsdMicros: null,
        pricedModelCalls: 0,
        unpricedModelCalls: 0,
      },
    }),
    listArtifacts: async () => ({ data: { items: [] } }),
    listAgents: async () => ({
      data: { agents: [] },
      requestId: "req-agents-list",
    }),
    listAgentVersions: async () => ({
      data: { versions: [] },
      requestId: "req-agent-versions",
    }),
    listWorkflows: async () => ({ data: { workflows: [] } }),
    createWorkflow: async () => {
      throw new Error("not implemented");
    },
    appendWorkflowVersion: async () => {
      throw new Error("not implemented");
    },
    getWorkflow: async () => {
      throw new Error("not implemented");
    },
    listWorkflowVersions: async () => ({ data: { versions: [] } }),
    getWorkflowVersion: async () => {
      throw new Error("not implemented");
    },
    listWorkflowRuns: async () => ({ data: { workflowRuns: [] } }),
    getWorkflowRun: async () => {
      throw new Error("not implemented");
    },
    getApprovalRequest: async () => {
      throw new Error("not implemented");
    },
    decideApprovalRequest: async () => ({ data: {} }),
    ingestWorkflowEvent: async () => ({ data: {}, requestId: "req-event" }),
    ...overrides,
  };
}

describe("console server API", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      server = undefined;
    }
  });

  it("returns safe auth context without exposing the API key", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient(),
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/auth/context`,
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-osva-request-id")).toBe("req-auth-success");
    expect(body).toContain("workspace-1");
    expect(body).not.toContain("super-secret-console-key");
    expect(body).not.toContain("Bearer");
  });

  it.each([
    [401, "req-auth-401", "authentication_required"],
    [403, "req-forbidden", "permission_denied"],
    [404, "req-not-found-upstream", "not_found"],
    [500, "req-server-error", "internal_error"],
  ] as const)(
    "forwards upstream request ID on %i responses",
    async (status, requestId, code) => {
      server = createConsoleServer({
        config: testConfig,
        client: createMockClient({
          getRun: async () => {
            const { OsvaApiError } = await import("@osva-ai/sdk");
            throw new OsvaApiError(status, { status: code }, requestId);
          },
        }),
      });
      await new Promise<void>((resolve) => server!.listen(0, resolve));
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected server address");
      }

      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/runs/run-missing`,
      );
      const body = (await response.json()) as { requestId?: string };
      expect(response.status).toBe(status);
      expect(response.headers.get("x-osva-request-id")).toBe(requestId);
      expect(body.requestId).toBe(requestId);
    },
  );

  it("rejects unsupported console proxy paths", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient(),
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/unsupported-resource`,
    );
    expect(response.status).toBe(404);
  });

  it("accepts POST on explicit mutation routes", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient({
        ingestWorkflowEvent: async () => ({
          data: { id: "we-1" },
          requestId: "req-event-1",
        }),
      }),
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/workflow-events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "demo",
          eventType: "ready",
          correlationKey: "corr",
          idempotencyKey: "idem-1",
          payload: {},
        }),
      },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("x-osva-request-id")).toBe("req-event-1");
  });

  it("forwards workflow creation and version append POST routes", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient({
        createWorkflow: async () => ({
          data: {
            id: "wf-new",
            workspaceId: "workspace-1",
            key: "demo",
            name: "Demo",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          requestId: "req-wf-create",
        }),
        appendWorkflowVersion: async () => ({
          data: {
            id: "wv-1",
            workflowId: "wf-new",
            workspaceId: "workspace-1",
            version: 1,
            definition: { schemaVersion: "3", nodes: [], edges: [] },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          requestId: "req-wf-version",
        }),
      }),
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const createResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/workflows`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "demo", name: "Demo" }),
      },
    );
    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("x-osva-request-id")).toBe(
      "req-wf-create",
    );

    const versionResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/workflows/wf-new/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          definition: { schemaVersion: "3", nodes: [], edges: [] },
        }),
      },
    );
    expect(versionResponse.status).toBe(201);
    expect(versionResponse.headers.get("x-osva-request-id")).toBe(
      "req-wf-version",
    );
  });

  it("forwards agent discovery GET routes", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient(),
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const agentsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/agents`,
    );
    expect(agentsResponse.status).toBe(200);
    expect(agentsResponse.headers.get("x-osva-request-id")).toBe(
      "req-agents-list",
    );

    const versionsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/agents/agent-1/versions`,
    );
    expect(versionsResponse.status).toBe(200);
    expect(versionsResponse.headers.get("x-osva-request-id")).toBe(
      "req-agent-versions",
    );
  });

  it("rejects non-GET methods on console API routes", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient(),
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/runs`,
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(405);
  });

  it("reports missing configuration state", async () => {
    server = createConsoleServer({ config: undefined, client: undefined });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/auth/context`,
    );
    expect(response.status).toBe(503);
  });
});
