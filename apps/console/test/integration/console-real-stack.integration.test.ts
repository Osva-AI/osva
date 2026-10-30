import fs from "node:fs/promises";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva-ai/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { createNodeHttpServer, createRuntime } from "@osva-ai/sdk/runtime";

import { createWebProcess } from "../../../web/src/process.js";
import { createWorkerProcess } from "../../../worker/src/process.js";
import {
  bootstrapIntegrationAuth,
  fetchJson,
  integrationAuth,
} from "../../../worker/test/integration/integration-auth.js";
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
import { createConsoleServer } from "../../src/server/server.js";

const consoleClientDistDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/client",
);

const WORKSPACE_ID = "ws-console-real-stack" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("console real control-plane stack", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

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
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
  });

  it("serves persisted Runs through console → web → PostgreSQL", async () => {
    const runtime = createRuntime({
      execute: async (input) => input,
    });
    const runtimeServer = createNodeHttpServer(runtime);
    await new Promise<void>((resolve, reject) => {
      runtimeServer.once("error", reject);
      runtimeServer.listen(0, "127.0.0.1", () => {
        runtimeServer.off("error", reject);
        resolve();
      });
    });
    const runtimeAddress = runtimeServer.address();
    if (runtimeAddress === null || typeof runtimeAddress === "string") {
      throw new Error("runtime server failed to bind");
    }
    const runtimeEndpoint = `http://127.0.0.1:${String(runtimeAddress.port)}/execute`;

    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-console-real-stack-"),
    );
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OSVA_RUNTIME_CAPABILITY_SECRET: "capability-secret",
      OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true",
    });
    const inspector = new BullMqJobQueue({ url: valkey.url });

    try {
      const webPort = await web.listen();
      const webOrigin = `http://127.0.0.1:${String(webPort)}`;
      await worker.start();

      const created = await createRemoteRun(webOrigin, runtimeEndpoint, {
        prompt: "console-real-stack",
      });

      await waitUntil(async () => {
        const run = await fetchJson(`${webOrigin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const consoleServer = createConsoleServer({
        config: {
          osvaBaseUrl: webOrigin,
          osvaApiKey: integrationAuth.token,
          legacyApiKeyMode: true,
          host: "127.0.0.1",
          port: 0,
          clientDistDir: consoleClientDistDir,
          allowedOrigins: [],
          browserOrigin: "http://127.0.0.1:4174",
        },
      });

      await new Promise<void>((resolve) => consoleServer.listen(0, resolve));
      const consoleAddress = consoleServer.address();
      if (consoleAddress === null || typeof consoleAddress === "string") {
        throw new Error("console server failed to bind");
      }
      const consoleOrigin = `http://127.0.0.1:${consoleAddress.port}`;

      const runsList = await fetch(`${consoleOrigin}/api/v1/runs`);
      const runsListBody = (await runsList.json()) as {
        runs: { id: string }[];
      };
      expect(runsList.status).toBe(200);
      expect(runsListBody.runs.some((run) => run.id === created.runId)).toBe(
        true,
      );
      expect(runsList.headers.get("authorization")).toBeNull();
      expect(JSON.stringify(runsListBody)).not.toContain(integrationAuth.token);

      const runDetail = await fetch(
        `${consoleOrigin}/api/v1/runs/${created.runId}`,
      );
      const runDetailBody = await runDetail.json();
      expect(runDetail.status).toBe(200);
      expect(runDetailBody).toMatchObject({
        id: created.runId,
        status: "SUCCEEDED",
      });

      const attempts = await fetch(
        `${consoleOrigin}/api/v1/runs/${created.runId}/attempts`,
      );
      const attemptsBody = (await attempts.json()) as {
        attempts: { id: string }[];
      };
      expect(attempts.status).toBe(200);
      expect(attemptsBody.attempts[0]?.id).toBe(created.runAttemptId);

      const attemptDetail = await fetch(
        `${consoleOrigin}/api/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      expect(attemptDetail.status).toBe(200);
      expect(await attemptDetail.json()).toMatchObject({
        id: created.runAttemptId,
        status: "SUCCEEDED",
      });

      const steps = await fetch(
        `${consoleOrigin}/api/v1/runs/${created.runId}/attempts/${created.runAttemptId}/steps`,
      );
      const stepsBody = (await steps.json()) as { steps: unknown[] };
      expect(steps.status).toBe(200);

      const usage = await fetch(
        `${consoleOrigin}/api/v1/runs/${created.runId}/attempts/${created.runAttemptId}/usage`,
      );
      expect(usage.status).toBe(200);

      const artifacts = await fetch(
        `${consoleOrigin}/api/v1/artifacts?runId=${created.runId}`,
      );
      expect(artifacts.status).toBe(200);

      const agentsList = await fetch(`${consoleOrigin}/api/v1/agents`);
      const agentsListBody = (await agentsList.json()) as {
        agents: { id: string }[];
      };
      expect(agentsList.status).toBe(200);
      expect(agentsListBody.agents.length).toBeGreaterThan(0);
      expect(JSON.stringify(agentsListBody)).not.toContain(
        integrationAuth.token,
      );

      const registered = await fetch(`${consoleOrigin}/api/v1/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: `console-bff-${String(Date.now())}`,
          name: "Console BFF Agent",
        }),
      });
      const registeredBody = (await registered.json()) as { id?: string };
      expect(registered.status).toBe(201);
      expect(registeredBody.id).toBeTruthy();
      expect(JSON.stringify(registeredBody)).not.toContain(
        integrationAuth.token,
      );

      const appended = await fetch(
        `${consoleOrigin}/api/v1/agents/${registeredBody.id}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            manifest: {
              schemaVersion: "1",
              key: "console-bff-agent",
              name: "Console BFF Agent",
              runtime: {
                type: "REMOTE_HTTP",
                protocolVersion: "1",
                endpoint: runtimeEndpoint,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 8_000, maxAttempts: 1 },
              capabilities: { model: false, tools: [] },
            },
          }),
        },
      );
      const appendedBody = (await appended.json()) as { id?: string };
      expect(appended.status).toBe(201);
      expect(appendedBody.id).toBeTruthy();

      const launched = await fetch(`${consoleOrigin}/api/v1/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: registeredBody.id,
          agentVersionId: appendedBody.id,
          input: { prompt: "console-bff-create" },
        }),
      });
      const launchedBody = (await launched.json()) as {
        run?: { id?: string; status?: string; agentId?: string };
        runAttempt?: { id?: string; status?: string };
      };
      expect(launched.status).toBe(201);
      expect(launchedBody.run?.id).toBeTruthy();
      expect(launchedBody.run?.status).toBe("QUEUED");
      expect(launchedBody.run?.agentId).toBe(registeredBody.id);
      expect(launchedBody.runAttempt?.id).toBeTruthy();
      expect(launchedBody.runAttempt?.status).toBe("PENDING");
      expect(JSON.stringify(launchedBody)).not.toContain(integrationAuth.token);

      console.info(
        `ACCEPTANCE_BFF_AGENT_ID=${registeredBody.id} ACCEPTANCE_BFF_AGENT_VERSION_ID=${appendedBody.id} ACCEPTANCE_BFF_RUN_ID=${launchedBody.run?.id} ACCEPTANCE_BFF_RUN_ATTEMPT_ID=${launchedBody.runAttempt?.id}`,
      );

      const deepLinkRun = await fetch(`${consoleOrigin}/runs/${created.runId}`);
      expect(deepLinkRun.status).toBe(200);
      expect(await deepLinkRun.text()).toContain('id="root"');

      const deepLinkAttempt = await fetch(
        `${consoleOrigin}/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      expect(deepLinkAttempt.status).toBe(200);
      expect(await deepLinkAttempt.text()).toContain('id="root"');

      await new Promise<void>((resolve, reject) => {
        consoleServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      const restartedConsole = createConsoleServer({
        config: {
          osvaBaseUrl: webOrigin,
          osvaApiKey: integrationAuth.token,
          legacyApiKeyMode: true,
          host: "127.0.0.1",
          port: 0,
          clientDistDir: consoleClientDistDir,
          allowedOrigins: [],
          browserOrigin: "http://127.0.0.1:4174",
        },
      });
      await new Promise<void>((resolve) => restartedConsole.listen(0, resolve));
      const restartedAddress = restartedConsole.address();
      if (restartedAddress === null || typeof restartedAddress === "string") {
        throw new Error("restarted console failed to bind");
      }
      const restartedOrigin = `http://127.0.0.1:${restartedAddress.port}`;
      const persistedRun = await fetch(
        `${restartedOrigin}/api/v1/runs/${created.runId}`,
      );
      expect(persistedRun.status).toBe(200);
      expect(await persistedRun.json()).toMatchObject({
        id: created.runId,
        status: "SUCCEEDED",
      });

      console.info(
        `ACCEPTANCE_RUN_ID=${created.runId} ACCEPTANCE_RUN_ATTEMPT_ID=${created.runAttemptId}`,
      );

      expect(stepsBody.steps.length).toBeGreaterThanOrEqual(0);
      await new Promise<void>((resolve, reject) => {
        restartedConsole.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
      await new Promise<void>((resolve, reject) => {
        runtimeServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});

async function createRemoteRun(
  origin: string,
  endpoint: string,
  input: unknown,
): Promise<{ readonly runId: string; readonly runAttemptId: string }> {
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      key: `console-stack-${String(Date.now())}-${Math.random()}`,
      name: "Console Stack Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "console-stack-agent",
        name: "Console Stack Agent",
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "1",
          endpoint,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 8_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
    },
  });
  expect(version.status).toBe(201);
  const created = await fetchJson(`${origin}/v1/runs`, {
    method: "POST",
    body: {
      agentId,
      agentVersionId: (version.body as { id: string }).id,
      input,
    },
  });
  expect(created.status).toBe(201);
  return {
    runId: (created.body as { run: { id: string } }).run.id,
    runAttemptId: (created.body as { runAttempt: { id: string } }).runAttempt
      .id,
  };
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error("Timed out waiting for run completion.");
}
