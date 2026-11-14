import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";

import {
  FAKE_GITHUB_PAT,
  startMockGithubHttpServer,
  type MockGithubHttpServer,
} from "../../../../packages/tool-gateway/test/fixtures/mock-github-http-server.js";
import { createWebProcess } from "../../../web/src/process.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
import { createWorkerProcess } from "../../src/process.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import {
  B7_1_STDIO_WEB_ENV,
  B7_1_STDIO_WORKER_ENV,
  agentIntegrity,
  assertToolRunStep,
  buildStdioTransportConfig,
  copyAgentFixtures,
  createAndAwaitRun,
  createTrustedTypescriptAgent,
  loadRunSteps,
} from "./b7-1-stdio-runtime-harness.js";
import {
  GITHUB_FIXTURE_SECRET_REF_KEY,
  GITHUB_LEAK_MARKER,
  GITHUB_REPOSITORY_GET_BINDING,
  assertFixtureRepositoryOutput,
  assertNoSecretLeakInJson,
  buildGithubFixtureTransportConfig,
  fixturePatEnv,
  isGithubFixtureStdioAvailable,
  resolveGithubFixtureStdioEntry,
  seedGithubRepositoryGetTool,
} from "./b7-2-github-operational.harness.js";

const WORKSPACE_ID =
  "ws-b7-2-github-fixture" as import("@osva-ai/contracts").WorkspaceId;
const NOW = new Date("2026-02-01T12:00:00.000Z");
const FIXTURE_READY = isGithubFixtureStdioAvailable();

describe.skipIf(!FIXTURE_READY)(
  "FIXTURE_BACKED_RUNTIME_ACCEPTANCE — GitHub MCP STDIO via real worker",
  () => {
    let postgres: PostgresTestContext;
    let valkey: ValkeyTestContext;
    let database: Database;
    let mockGithub: MockGithubHttpServer;

    beforeAll(async () => {
      postgres = await startPostgresForTests();
      valkey = await startValkeyForTests();
      database = createDatabase({
        connectionString: postgres.connectionString,
        max: 5,
        connectTimeoutSeconds: 10,
      });
      await migrateDatabase(database);
    }, 300_000);

    afterAll(async () => {
      if (database) {
        await database.close();
      }
      if (postgres) {
        await stopPostgresForTests(postgres);
      }
      if (valkey) {
        await stopValkeyForTests(valkey);
      }
    }, 300_000);

    beforeEach(async () => {
      await resetStage0Tables(database);
      await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
      mockGithub = await startMockGithubHttpServer({
        expectedToken: FAKE_GITHUB_PAT,
      });
    });

    async function startStack(options: {
      readonly patValue?: string;
      readonly workerStdioEnabled?: boolean;
      readonly includeSecretOnConnector?: boolean;
    }) {
      const trustedRuntimeRoot = await copyAgentFixtures(
        "mcp-github-repository-get-agent.ts",
      );
      const integrity = await agentIntegrity(
        trustedRuntimeRoot,
        "mcp-github-repository-get-agent.ts",
      );
      const secretEnv = fixturePatEnv(options.patValue ?? FAKE_GITHUB_PAT);
      const shared = {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
        ...secretEnv,
      };
      const web = createWebProcess(
        withTestAuthEnv({
          ...shared,
          OSVA_WEB_HOST: "127.0.0.1",
          OSVA_WEB_PORT: "0",
          ...B7_1_STDIO_WEB_ENV,
        }),
      );
      const worker = createWorkerProcess({
        ...shared,
        ...(options.workerStdioEnabled === false ? {} : B7_1_STDIO_WORKER_ENV),
      });
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      return {
        origin,
        web,
        worker,
        trustedRuntimeRoot,
        integrity,
        includeSecretOnConnector: options.includeSecretOnConnector ?? true,
      };
    }

    it("reads repository metadata via github.repository.get with persisted TOOL RunStep", async () => {
      const stack = await startStack({});
      try {
        const seeded = await seedGithubRepositoryGetTool({
          origin: stack.origin,
          transportConfig: buildGithubFixtureTransportConfig({
            stdioEntry: resolveGithubFixtureStdioEntry(),
            apiBaseUrl: mockGithub.apiBaseUrl,
          }),
        });
        const version = await fetchJson(
          `${stack.origin}/v1/connectors/${seeded.connectorId}/versions/${seeded.connectorVersionId}`,
        );
        assertNoSecretLeakInJson(JSON.stringify(version.body), FAKE_GITHUB_PAT);
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-2-github-read",
          agentName: "B7.2 GitHub Read",
          entrypoint: "mcp-github-repository-get-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [GITHUB_REPOSITORY_GET_BINDING]: {
              toolVersionId: seeded.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { owner: "Osva-AI", repo: "osva" },
        });
        expect(run.terminalStatus).toBe("SUCCEEDED");
        expect(mockGithub.getRepositoryRequestCount()).toBeGreaterThan(0);
        const attempt = await fetchJson(
          `${stack.origin}/v1/runs/${run.runId}/attempts/${run.runAttemptId}`,
        );
        assertFixtureRepositoryOutput(
          (attempt.body as { output?: unknown }).output,
        );
        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        assertToolRunStep({
          steps,
          toolVersionId: seeded.toolVersionId,
          bindingName: GITHUB_REPOSITORY_GET_BINDING,
          status: "SUCCEEDED",
        });
        assertNoSecretLeakInJson(JSON.stringify(attempt.body), FAKE_GITHUB_PAT);
        assertNoSecretLeakInJson(JSON.stringify(steps), FAKE_GITHUB_PAT);
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockGithub.close();
      }
    }, 180_000);

    it("fails discovery when the secret reference cannot be resolved", async () => {
      const web = createWebProcess(
        withTestAuthEnv({
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_WEB_HOST: "127.0.0.1",
          OSVA_WEB_PORT: "0",
          ...B7_1_STDIO_WEB_ENV,
          OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
        }),
      );
      try {
        const port = await web.listen();
        const origin = `http://127.0.0.1:${String(port)}`;
        const connector = await fetchJson(`${origin}/v1/connectors`, {
          method: "POST",
          body: { key: "b7-2-missing-secret", name: "Missing Secret" },
        });
        const connectorId = (connector.body as { id: string }).id;
        const version = await fetchJson(
          `${origin}/v1/connectors/${connectorId}/versions`,
          {
            method: "POST",
            body: {
              kind: "MCP",
              transport: "STDIO",
              transportConfig: buildGithubFixtureTransportConfig({
                stdioEntry: resolveGithubFixtureStdioEntry(),
                apiBaseUrl: mockGithub.apiBaseUrl,
              }),
            },
          },
        );
        expect(version.status).toBe(201);
        const connectorVersionId = (version.body as { id: string }).id;
        const discovered = await fetchJson(
          `${origin}/v1/connectors/${connectorId}/versions/${connectorVersionId}/discover`,
          { method: "POST", body: {} },
        );
        expect(discovered.status).toBeGreaterThanOrEqual(400);
      } finally {
        await web.stop();
        await mockGithub.close();
      }
    });

    it("records failed TOOL RunStep on invalid credentials (401)", async () => {
      const stack = await startStack({ patValue: "ghp_wrong_token_for_test" });
      try {
        const seeded = await seedGithubRepositoryGetTool({
          origin: stack.origin,
          transportConfig: buildGithubFixtureTransportConfig({
            stdioEntry: resolveGithubFixtureStdioEntry(),
            apiBaseUrl: mockGithub.apiBaseUrl,
          }),
        });
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-2-github-bad-pat",
          agentName: "B7.2 Bad PAT",
          entrypoint: "mcp-github-repository-get-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [GITHUB_REPOSITORY_GET_BINDING]: {
              toolVersionId: seeded.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { owner: "Osva-AI", repo: "osva" },
        });
        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        const toolStep = assertToolRunStep({
          steps,
          toolVersionId: seeded.toolVersionId,
          bindingName: GITHUB_REPOSITORY_GET_BINDING,
          status: "FAILED",
        });
        assertNoSecretLeakInJson(JSON.stringify(toolStep), "ghp_wrong");
        assertNoSecretLeakInJson(JSON.stringify(toolStep), GITHUB_LEAK_MARKER);
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockGithub.close();
      }
    });

    it("sanitizes GitHub 5xx provider diagnostics", async () => {
      mockGithub.setMode("server_error");
      const stack = await startStack({});
      try {
        const seeded = await seedGithubRepositoryGetTool({
          origin: stack.origin,
          transportConfig: buildGithubFixtureTransportConfig({
            stdioEntry: resolveGithubFixtureStdioEntry(),
            apiBaseUrl: mockGithub.apiBaseUrl,
          }),
        });
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-2-github-5xx",
          agentName: "B7.2 GitHub 5xx",
          entrypoint: "mcp-github-repository-get-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [GITHUB_REPOSITORY_GET_BINDING]: {
              toolVersionId: seeded.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { owner: "Osva-AI", repo: "osva" },
        });
        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        const toolStep = assertToolRunStep({
          steps,
          toolVersionId: seeded.toolVersionId,
          bindingName: GITHUB_REPOSITORY_GET_BINDING,
          status: "FAILED",
        });
        assertNoSecretLeakInJson(JSON.stringify(toolStep), GITHUB_LEAK_MARKER);
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockGithub.close();
      }
    });

    it("surfaces 404 repository not found on failed TOOL step", async () => {
      mockGithub.setMode("not_found");
      const stack = await startStack({});
      try {
        const seeded = await seedGithubRepositoryGetTool({
          origin: stack.origin,
          transportConfig: buildGithubFixtureTransportConfig({
            stdioEntry: resolveGithubFixtureStdioEntry(),
            apiBaseUrl: mockGithub.apiBaseUrl,
          }),
        });
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-2-github-404",
          agentName: "B7.2 GitHub 404",
          entrypoint: "mcp-github-repository-get-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [GITHUB_REPOSITORY_GET_BINDING]: {
              toolVersionId: seeded.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { owner: "Osva-AI", repo: "osva" },
        });
        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        assertToolRunStep({
          steps,
          toolVersionId: seeded.toolVersionId,
          bindingName: GITHUB_REPOSITORY_GET_BINDING,
          status: "FAILED",
        });
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockGithub.close();
      }
    });

    it("does not invoke GitHub when logical tool is unbound", async () => {
      const trustedRuntimeRoot = await copyAgentFixtures(
        "mcp-github-repository-get-agent.ts",
        "mcp-unauthorized-agent.ts",
      );
      const integrity = await agentIntegrity(
        trustedRuntimeRoot,
        "mcp-unauthorized-agent.ts",
      );
      const secretEnv = fixturePatEnv(FAKE_GITHUB_PAT);
      const shared = {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
        ...secretEnv,
      };
      const web = createWebProcess(
        withTestAuthEnv({
          ...shared,
          OSVA_WEB_HOST: "127.0.0.1",
          OSVA_WEB_PORT: "0",
          ...B7_1_STDIO_WEB_ENV,
        }),
      );
      const worker = createWorkerProcess({
        ...shared,
        ...B7_1_STDIO_WORKER_ENV,
      });
      const priorCount = mockGithub.getRepositoryRequestCount();
      try {
        const port = await web.listen();
        await worker.start();
        const origin = `http://127.0.0.1:${String(port)}`;
        const seeded = await seedGithubRepositoryGetTool({
          origin,
          transportConfig: buildGithubFixtureTransportConfig({
            stdioEntry: resolveGithubFixtureStdioEntry(),
            apiBaseUrl: mockGithub.apiBaseUrl,
          }),
        });
        const agents = await createTrustedTypescriptAgent({
          origin,
          agentKey: "b7-2-github-unbound",
          agentName: "B7.2 Unbound",
          entrypoint: "mcp-unauthorized-agent.ts",
          integrity,
          toolBindings: {
            [GITHUB_REPOSITORY_GET_BINDING]: {
              toolVersionId: seeded.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: {},
        });
        expect(run.terminalStatus).toBe("SUCCEEDED");
        expect(mockGithub.getRepositoryRequestCount()).toBe(priorCount);
        const steps = await loadRunSteps(origin, run.runId, run.runAttemptId);
        expect(steps.some((step) => step.kind === "TOOL")).toBe(false);
      } finally {
        await worker.stop();
        await web.stop();
        await mockGithub.close();
      }
    });

    it("fails tool execution when worker STDIO gate is disabled", async () => {
      const stack = await startStack({ workerStdioEnabled: false });
      try {
        const seeded = await seedGithubRepositoryGetTool({
          origin: stack.origin,
          transportConfig: buildGithubFixtureTransportConfig({
            stdioEntry: resolveGithubFixtureStdioEntry(),
            apiBaseUrl: mockGithub.apiBaseUrl,
          }),
        });
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-2-worker-stdio-off",
          agentName: "B7.2 Worker STDIO Off",
          entrypoint: "mcp-github-repository-get-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [GITHUB_REPOSITORY_GET_BINDING]: {
              toolVersionId: seeded.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { owner: "Osva-AI", repo: "osva" },
        });
        expect(run.terminalStatus).toBe("FAILED");
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockGithub.close();
      }
    });

    it("rejects STDIO connector version on web when operator gate is off", async () => {
      const web = createWebProcess(
        withTestAuthEnv({
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_WEB_HOST: "127.0.0.1",
          OSVA_WEB_PORT: "0",
          OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
          [GITHUB_FIXTURE_SECRET_REF_KEY]: FAKE_GITHUB_PAT,
        }),
      );
      try {
        const port = await web.listen();
        const origin = `http://127.0.0.1:${String(port)}`;
        const connector = await fetchJson(`${origin}/v1/connectors`, {
          method: "POST",
          body: { key: "b7-2-stdio-gate", name: "Gate" },
        });
        const denied = await fetchJson(
          `${origin}/v1/connectors/${(connector.body as { id: string }).id}/versions`,
          {
            method: "POST",
            body: {
              kind: "MCP",
              transport: "STDIO",
              transportConfig: buildStdioTransportConfig(
                resolveGithubFixtureStdioEntry(),
              ),
            },
          },
        );
        expect(denied.status).toBe(403);
      } finally {
        await web.stop();
        await mockGithub.close();
      }
    });
  },
);

describe("FIXTURE_BACKED_RUNTIME_ACCEPTANCE — GitHub fixture availability", () => {
  it("reports skip when osva-connectors stdio fixture is absent", () => {
    if (FIXTURE_READY) {
      expect(resolveGithubFixtureStdioEntry().length).toBeGreaterThan(0);
      return;
    }
    expect(FIXTURE_READY).toBe(false);
  });
});
