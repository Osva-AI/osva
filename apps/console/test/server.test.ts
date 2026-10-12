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
    getArtifact: async () => {
      throw new Error("not implemented");
    },
    downloadArtifact: async () => {
      throw new Error("not implemented");
    },
    listAgents: async () => ({
      data: { agents: [] },
      requestId: "req-agents-list",
    }),
    listAgentVersions: async () => ({
      data: {
        versions: [
          {
            id: "av-research",
            agentId: "agent-1",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            manifest: {
              input: {
                schema: {
                  type: "object",
                  required: ["schemaVersion"],
                  properties: { schemaVersion: { const: "1" } },
                },
              },
            },
          },
        ],
      },
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
    createWorkflowRun: async () => {
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

  it("forwards WorkflowRun creation POST and preserves the request id", async () => {
    let forwardedBody: unknown;
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient({
        createWorkflowRun: async (body) => {
          forwardedBody = body;
          return {
            data: {
              id: "wr-1",
              workspaceId: "workspace-1",
              workflowId: "wf-1",
              workflowVersionId: "wv-1",
              status: "PENDING",
              input: { ok: true },
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              nodeRuns: [],
              approvalRequests: [],
            },
            requestId: "req-wr-create",
          };
        },
      }),
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/workflow-runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workflowVersionId: "wv-1",
          input: { ok: true },
        }),
      },
    );
    const body = (await response.json()) as { id?: string };
    expect(response.status).toBe(201);
    expect(response.headers.get("x-osva-request-id")).toBe("req-wr-create");
    expect(body.id).toBe("wr-1");
    expect(forwardedBody).toEqual({
      workflowVersionId: "wv-1",
      input: { ok: true },
    });
  });

  it("propagates control-plane authorization failures for WorkflowRun create", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient({
        createWorkflowRun: async () => {
          const { OsvaApiError } = await import("@osva-ai/sdk");
          throw new OsvaApiError(
            403,
            { status: "permission_denied" },
            "req-wr-forbidden",
          );
        },
      }),
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/workflow-runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workflowVersionId: "wv-1",
          input: {},
        }),
      },
    );
    const body = (await response.json()) as { requestId?: string };
    expect(response.status).toBe(403);
    expect(response.headers.get("x-osva-request-id")).toBe("req-wr-forbidden");
    expect(body.requestId).toBe("req-wr-forbidden");
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
    const versionsBody = (await versionsResponse.json()) as {
      versions: Array<{
        id: string;
        manifest?: { input?: { schema?: unknown } };
      }>;
    };
    expect(versionsBody.versions[0]?.id).toBe("av-research");
    expect(versionsBody.versions[0]?.manifest?.input?.schema).toEqual({
      type: "object",
      required: ["schemaVersion"],
      properties: { schemaVersion: { const: "1" } },
    });
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

  it("returns artifact metadata without exposing the API key", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient({
        getArtifact: async (artifactId) => ({
          data: {
            id: artifactId,
            workspaceId: "workspace-1",
            name: "report.md",
            mediaType: "text/markdown",
            sizeBytes: 12,
            digest: `sha256:${"a".repeat(64)}`,
            metadata: {},
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          requestId: "req-artifact-get",
        }),
      }),
    });
    const origin = await listen(server);

    const response = await fetch(`${origin}/api/v1/artifacts/artifact-1`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-osva-request-id")).toBe("req-artifact-get");
    expect(JSON.parse(body)).toMatchObject({
      id: "artifact-1",
      name: "report.md",
      mediaType: "text/markdown",
    });
    expect(body).not.toContain("super-secret-console-key");
    expect(body).not.toContain("Bearer");
    expect(body).not.toContain(".osva/artifacts");
    expect(body).not.toContain("s3://");
  });

  it.each([
    [401, "req-artifact-401", "authentication_required"],
    [403, "req-artifact-403", "permission_denied"],
    [404, "req-artifact-404", "not_found"],
    [503, "req-artifact-503", "unavailable"],
  ] as const)(
    "forwards artifact metadata %i from the control plane",
    async (status, requestId, code) => {
      server = createConsoleServer({
        config: testConfig,
        client: createMockClient({
          getArtifact: async () => {
            const { OsvaApiError } = await import("@osva-ai/sdk");
            throw new OsvaApiError(status, { status: code }, requestId);
          },
        }),
      });
      const origin = await listen(server);

      const response = await fetch(`${origin}/api/v1/artifacts/missing`);
      const body = (await response.json()) as {
        error?: string;
        requestId?: string;
        code?: string;
      };
      expect(response.status).toBe(status);
      expect(response.headers.get("x-osva-request-id")).toBe(requestId);
      expect(body.requestId).toBe(requestId);
      expect(body.code).toBe(code);
      expect(JSON.stringify(body)).not.toContain("super-secret-console-key");
      expect(JSON.stringify(body)).not.toContain(".osva/artifacts");
    },
  );

  it("rejects unsafe artifact ids", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient(),
    });
    const origin = await listen(server);

    const response = await fetch(`${origin}/api/v1/artifacts/has..dots`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("invalid_request");
  });

  it("streams artifact bytes with forced download headers", async () => {
    const payload = Uint8Array.from([0x00, 0x01, 0xff, 0x7f]);
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient({
        downloadArtifact: async () => ({
          status: 200,
          headers: new Headers({
            "content-type": "text/html",
            "content-length": String(payload.length),
            "content-disposition": 'inline; filename="evil.html"',
            "x-content-type-options": "nosniff",
            digest: `sha256:${"b".repeat(64)}`,
            authorization: "Bearer leaked",
            "set-cookie": "session=1",
            location: "s3://bucket/v1/artifact-1",
          }),
          body: uint8Stream(payload),
          requestId: "req-artifact-content",
        }),
      }),
    });
    const origin = await listen(server);

    const response = await fetch(
      `${origin}/api/v1/artifacts/artifact-1/content`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-disposition")).toContain("evil.html");
    expect(response.headers.get("content-disposition")).not.toContain("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe(String(payload.length));
    expect(response.headers.get("digest")).toBe(`sha256:${"b".repeat(64)}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-osva-request-id")).toBe(
      "req-artifact-content",
    );
    expect(response.headers.get("authorization")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toEqual(payload);
  });

  it("sanitizes attachment filenames and rejects header injection", async () => {
    const payload = Uint8Array.from([0x41]);
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient({
        downloadArtifact: async () => ({
          status: 200,
          headers: headerMap({
            "content-type": "text/plain",
            "content-disposition":
              'attachment; filename="ok.md\r\nX-Injected: yes"',
          }),
          body: uint8Stream(payload),
        }),
      }),
    });
    const origin = await listen(server);

    const response = await fetch(
      `${origin}/api/v1/artifacts/artifact-1/content`,
    );
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(response.status).toBe(200);
    expect(disposition).toContain("attachment");
    expect(disposition).not.toMatch(/\r|\n/);
    expect(disposition).not.toContain("X-Injected");
    expect(response.headers.get("x-injected")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
  });

  it.each([
    [401, "req-content-401", "authentication_required"],
    [403, "req-content-403", "permission_denied"],
    [404, "req-content-404", "not_found"],
    [503, "req-content-503", "unavailable"],
  ] as const)(
    "forwards artifact content %i from the control plane",
    async (status, requestId, code) => {
      server = createConsoleServer({
        config: testConfig,
        client: createMockClient({
          downloadArtifact: async () => {
            const { OsvaApiError } = await import("@osva-ai/sdk");
            throw new OsvaApiError(status, { status: code }, requestId);
          },
        }),
      });
      const origin = await listen(server);

      const response = await fetch(
        `${origin}/api/v1/artifacts/missing/content`,
      );
      const body = (await response.json()) as {
        error?: string;
        requestId?: string;
        code?: string;
      };
      expect(response.status).toBe(status);
      expect(response.headers.get("x-osva-request-id")).toBe(requestId);
      expect(body.requestId).toBe(requestId);
      expect(body.code).toBe(code);
      expect(JSON.stringify(body)).not.toContain("super-secret-console-key");
      expect(JSON.stringify(body)).not.toContain("v1/artifact");
    },
  );

  it("rejects unsupported methods on artifact routes", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient(),
    });
    const origin = await listen(server);

    const metadata = await fetch(`${origin}/api/v1/artifacts/artifact-1`, {
      method: "POST",
      body: "{}",
    });
    expect(metadata.status).toBe(405);

    const content = await fetch(
      `${origin}/api/v1/artifacts/artifact-1/content`,
      {
        method: "DELETE",
      },
    );
    expect(content.status).toBe(405);
  });

  it("destroys the download when the upstream body stream fails", async () => {
    server = createConsoleServer({
      config: testConfig,
      client: createMockClient({
        downloadArtifact: async () => ({
          status: 200,
          headers: new Headers({
            "content-type": "application/octet-stream",
          }),
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Uint8Array.from([1, 2, 3]));
              controller.error(new Error("upstream reset"));
            },
          }),
        }),
      }),
    });
    const origin = await listen(server);

    await expect(
      fetch(`${origin}/api/v1/artifacts/artifact-1/content`),
    ).rejects.toBeInstanceOf(Error);
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

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected server address");
  }
  return `http://127.0.0.1:${address.port}`;
}

function uint8Stream(payload: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload);
      controller.close();
    },
  });
}

function headerMap(values: Record<string, string>): Headers {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  } as Headers;
}
