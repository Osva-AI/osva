import {
  COMMUNITY_EDITION_ROLES,
  PUBLIC_API_ERROR_CODES,
} from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { seedWorkspaceBFixtures } from "./seed-workspace-b-fixtures.js";
import { authorizationHeader, seedTestApiKey } from "./test-web.js";
import {
  WS_A,
  WS_B,
  closeServers,
  createTwoWorkspaceHarness,
  expectForbidden,
  expectNotFound,
  expectUnauthorized,
  fetchV1,
} from "./two-workspace-harness.js";

describe("REST two-workspace security matrix", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await closeServers(servers);
  });

  it("requires authentication on /v1", async () => {
    const { origin } = await createTwoWorkspaceHarness(servers);
    const unauth = await fetchV1(`${origin}/v1/agents`);
    expectUnauthorized(unauth);
  });

  describe("agents", () => {
    it("isolates list/get/mutate using principal workspace only", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      await seedWorkspaceBFixtures(harness.ctx);

      const created = await fetchV1(`${harness.origin}/v1/agents`, {
        method: "POST",
        headers: harness.authA,
        body: { key: "a1", name: "A1" },
      });
      expect(created.status).toBe(201);
      const agentInA = (created.body as { id: string }).id;

      const listA = await fetchV1(`${harness.origin}/v1/agents`, {
        headers: harness.authA,
      });
      expect(listA.status).toBe(200);
      expect((listA.body as { agents: unknown[] }).agents).toHaveLength(1);

      expectNotFound(
        await fetchV1(`${harness.origin}/v1/agents/${agentInA}`, {
          headers: harness.authB,
        }),
      );
      expectNotFound(
        await fetchV1(`${harness.origin}/v1/agents/${agentInA}`, {
          method: "PATCH",
          headers: harness.authB,
          body: { name: "hack" },
        }),
      );
    });
  });

  describe("runs", () => {
    it("scopes list/get/attempts and rejects B agent on create", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      const agentA = await fetchV1(`${harness.origin}/v1/agents`, {
        method: "POST",
        headers: harness.authA,
        body: { key: "run-a", name: "Run A" },
      });
      const agentId = (agentA.body as { id: string }).id;
      const version = await fetchV1(
        `${harness.origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          headers: harness.authA,
          body: {
            manifest: {
              schemaVersion: "1",
              key: "run-a",
              name: "Run A",
              runtime: { type: "BUILTIN_PACKAGE", key: "run-a" },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 30_000, maxAttempts: 1 },
              capabilities: { model: false, tools: [] },
            },
          },
        },
      );
      const agentVersionId = (version.body as { id: string }).id;
      await fetchV1(`${harness.origin}/v1/runs`, {
        method: "POST",
        headers: harness.authA,
        body: {
          agentId,
          agentVersionId,
          input: { prompt: "a" },
        },
      });

      const list = await fetchV1(`${harness.origin}/v1/runs`, {
        headers: harness.authA,
      });
      expect(list.status).toBe(200);
      const runs = (list.body as { runs: { workspaceId: string }[] }).runs;
      expect(runs.every((run) => run.workspaceId === WS_A)).toBe(true);

      expectNotFound(
        await fetchV1(`${harness.origin}/v1/runs/${b.runId}`, {
          headers: harness.authA,
        }),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/runs/${b.runId}/attempts/${b.runAttemptId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(`${harness.origin}/v1/runs`, {
          method: "POST",
          headers: harness.authA,
          body: {
            agentId: b.agentId,
            agentVersionId: b.agentVersionId,
            input: { prompt: "cross" },
          },
        }),
      );
    });
  });

  describe("run observability", () => {
    it("returns 404 for B run child data", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/runs/${b.runId}/attempts/${b.runAttemptId}/steps`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/runs/${b.runId}/attempts/${b.runAttemptId}/usage`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/runs/${b.runId}/attempts/${b.runAttemptId}/evaluations`,
          { headers: harness.authA },
        ),
      );
    });
  });

  describe("workflows", () => {
    it("isolates workflow nested resources", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      const list = await fetchV1(`${harness.origin}/v1/workflows`, {
        headers: harness.authA,
      });
      expect(list.status).toBe(200);
      expect((list.body as { workflows: unknown[] }).workflows).toHaveLength(0);

      expectNotFound(
        await fetchV1(`${harness.origin}/v1/workflows/${b.workflowId}`, {
          headers: harness.authA,
        }),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/workflows/${b.workflowId}/versions/${b.workflowVersionId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(`${harness.origin}/v1/workflow-runs/${b.workflowRunId}`, {
          headers: harness.authA,
        }),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/approval-requests/${b.approvalRequestId}`,
          { headers: harness.authA },
        ),
      );
    });
  });

  describe("schedules", () => {
    it("scopes schedules and occurrences", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      const list = await fetchV1(`${harness.origin}/v1/schedules`, {
        headers: harness.authA,
      });
      expect(list.status).toBe(200);
      expect((list.body as { schedules: unknown[] }).schedules).toHaveLength(0);

      expectNotFound(
        await fetchV1(`${harness.origin}/v1/schedules/${b.scheduleId}`, {
          headers: harness.authA,
        }),
      );
      expectNotFound(
        await fetchV1(`${harness.origin}/v1/schedules/${b.scheduleId}`, {
          method: "PATCH",
          headers: harness.authA,
          body: { name: "x" },
        }),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/schedules/${b.scheduleId}/occurrences`,
          { headers: harness.authA },
        ),
      );
    });
  });

  describe("connectors", () => {
    it("isolates connector resources", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      const list = await fetchV1(`${harness.origin}/v1/connectors`, {
        headers: harness.authA,
      });
      expect(list.status).toBe(200);
      expect((list.body as { connectors: unknown[] }).connectors).toHaveLength(
        0,
      );

      expectNotFound(
        await fetchV1(`${harness.origin}/v1/connectors/${b.connectorId}`, {
          headers: harness.authA,
        }),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/connectors/${b.connectorId}/versions/${b.connectorVersionId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(`${harness.origin}/v1/connectors/${b.connectorId}`, {
          method: "PATCH",
          headers: harness.authA,
          body: { name: "x" },
        }),
      );
    });

    it("requires ADMIN for connector configuration", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const editor = await seedTestApiKey({
        apiKeys: harness.ctx.apiKeys,
        workspaceId: WS_A,
        role: COMMUNITY_EDITION_ROLES.EDITOR,
        apiKeyId: "ak-editor" as import("@osva/contracts").ApiKeyId,
      });
      expectForbidden(
        await fetchV1(`${harness.origin}/v1/connectors`, {
          method: "POST",
          headers: authorizationHeader(editor.plaintextToken),
          body: { key: "c1", name: "C1" },
        }),
      );
      expect(
        (
          await fetchV1(`${harness.origin}/v1/connectors`, {
            method: "POST",
            headers: harness.authA,
            body: { key: "c1", name: "C1" },
          })
        ).status,
      ).toBe(201);
    });
  });

  describe("tools and model profiles", () => {
    it("returns 404 for foreign tool and version", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      expect(
        (
          await fetchV1(`${harness.origin}/v1/tools`, {
            headers: harness.authA,
          })
        ).status,
      ).toBe(200);
      expectNotFound(
        await fetchV1(`${harness.origin}/v1/tools/${b.toolId}`, {
          headers: harness.authA,
        }),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/tools/${b.toolId}/versions/${b.toolVersionId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/model-profiles/${b.modelProfileId}`,
          { headers: harness.authA },
        ),
      );
    });
  });

  describe("artifacts", () => {
    it("scopes artifact metadata and content", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      const list = await fetchV1(`${harness.origin}/v1/artifacts`, {
        headers: harness.authA,
      });
      expect(list.status).toBe(200);
      expect((list.body as { items: unknown[] }).items).toHaveLength(0);

      const meta = await fetchV1(
        `${harness.origin}/v1/artifacts/${b.artifactId}`,
        { headers: harness.authA },
      );
      expectNotFound(meta);

      const content = await fetchV1(
        `${harness.origin}/v1/artifacts/${b.artifactId}/content`,
        { headers: harness.authA },
      );
      expectNotFound(content);
    });
  });

  describe("memory", () => {
    it("returns 404 for foreign namespace", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/memory/namespaces/${b.namespaceId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/memory/namespaces/${b.namespaceId}/records`,
          { headers: harness.authA },
        ),
      );
    });
  });

  describe("knowledge", () => {
    it("scopes lists to principal and blocks foreign IDs", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      const list = await fetchV1(`${harness.origin}/v1/knowledge-sources`, {
        headers: harness.authA,
      });
      expect(list.status).toBe(200);
      expect((list.body as { items: unknown[] }).items).toHaveLength(0);

      const staleQuery = await fetchV1(
        `${harness.origin}/v1/knowledge-sources?workspaceId=${WS_B}`,
        { headers: harness.authA },
      );
      expect(staleQuery.status).toBe(200);
      expect((staleQuery.body as { items: unknown[] }).items).toHaveLength(0);

      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/knowledge-sources/${b.knowledgeSourceId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/knowledge-indexes/${b.knowledgeIndexId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(`${harness.origin}/v1/knowledge/retrieve`, {
          method: "POST",
          headers: harness.authA,
          body: {
            knowledgeIndexIds: [b.knowledgeIndexId],
            query: "secret",
          },
        }),
      );
    });
  });

  describe("evaluations", () => {
    it("returns 404 for foreign suite/version/run", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/evaluation-suites/${b.evaluationSuiteId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/evaluation-suites/${b.evaluationSuiteId}/versions/${b.evaluationSuiteVersionId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/evaluation-runs/${b.evaluationRunId}`,
          { headers: harness.authA },
        ),
      );
    });
  });

  describe("office", () => {
    it("scopes office lists to principal workspace", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const b = await seedWorkspaceBFixtures(harness.ctx);

      const workers = await fetchV1(`${harness.origin}/v1/office/workers`, {
        headers: harness.authA,
      });
      expect(workers.status).toBe(200);
      expect(
        (workers.body as { items: { id: string }[] }).items.some(
          (worker) => worker.id === b.officeWorkerId,
        ),
      ).toBe(false);

      expectNotFound(
        await fetchV1(
          `${harness.origin}/v1/office/workers/${b.officeWorkerId}`,
          { headers: harness.authA },
        ),
      );
      expectNotFound(
        await fetchV1(`${harness.origin}/v1/office/teams/${b.teamId}`, {
          headers: harness.authA,
        }),
      );
    });
  });

  describe("role denial in workspace", () => {
    it("returns PERMISSION_DENIED for viewer writes", async () => {
      const harness = await createTwoWorkspaceHarness(servers);
      const viewer = await seedTestApiKey({
        apiKeys: harness.ctx.apiKeys,
        workspaceId: WS_A,
        role: COMMUNITY_EDITION_ROLES.VIEWER,
        apiKeyId: "ak-viewer-matrix" as import("@osva/contracts").ApiKeyId,
      });
      expectForbidden(
        await fetchV1(`${harness.origin}/v1/agents`, {
          method: "POST",
          headers: authorizationHeader(viewer.plaintextToken),
          body: { key: "x", name: "X" },
        }),
      );
      expect(
        (
          await fetchV1(`${harness.origin}/v1/agents`, {
            method: "POST",
            headers: harness.authA,
            body: { key: "ok", name: "OK" },
          }).then((r) => r.body as { code?: string })
        ).code,
      ).not.toBe(PUBLIC_API_ERROR_CODES.PERMISSION_DENIED);
    });
  });
});
