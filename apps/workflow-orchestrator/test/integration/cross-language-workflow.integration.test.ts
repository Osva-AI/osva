import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkflowRunRepository,
  type Database,
} from "@osva/db";
import {
  bootstrapIntegrationAuth,
  fetchJson,
} from "../../../worker/test/integration/integration-auth.js";
import { createWebProcess } from "../../../web/src/process.js";
import { createWorkerProcess } from "../../../worker/src/process.js";
import { createWorkflowOrchestratorProcess } from "../../src/process.js";
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

const WORKSPACE_ID = "ws-cross-language" as WorkspaceId;
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);
const PYTHON_SDK_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../sdks/python",
);

describe("cross-language workflow composition", () => {
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
    await bootstrapIntegrationAuth(
      database,
      WORKSPACE_ID,
      new Date("2026-01-15T12:00:00.000Z"),
    );
  });

  it("runs a trusted TypeScript agent followed by a Python remote agent without language metadata", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const pythonRuntime = await startPythonRuntimeServer();
    const queue = new BullMqJobQueue({ url: valkey.url });
    const web = createWebProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      () => queue,
    );

    let worker: ReturnType<typeof createWorkerProcess> | undefined;
    let orchestrator:
      ReturnType<typeof createWorkflowOrchestratorProcess> | undefined;

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const registered = await createCrossLanguageWorkflow(
        origin,
        trustedRuntimeRoot,
        `${pythonRuntime.origin}/execute`,
      );

      worker = createWorkerProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
          OSVA_RUNTIME_CAPABILITY_SECRET: "capability-secret",
          OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true",
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => queue },
      );
      orchestrator = createWorkflowOrchestratorProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => queue },
      );

      await worker.start();
      const workflowRuns = new PostgresWorkflowRunRepository(database);
      await waitUntil(async () => {
        await orchestrator!.tickOnce();
        const view = await workflowRuns.findWorkflowRunById(
          registered.workflowRunId as never,
        );
        return view?.status === "SUCCEEDED";
      });

      const loaded = await fetchJson(
        `${origin}/v1/workflow-runs/${registered.workflowRunId}`,
      );
      const body = loaded.body as {
        status: string;
        nodeRuns: ReadonlyArray<{
          workflowNodeKey: string;
          status: string;
          output?: unknown;
        }>;
      };
      expect(body.status).toBe("SUCCEEDED");
      const byKey = Object.fromEntries(
        body.nodeRuns.map((node) => [node.workflowNodeKey, node]),
      );
      expect(byKey.ts?.status).toBe("SUCCEEDED");
      expect(byKey.python?.status).toBe("SUCCEEDED");
      expect(byKey.python?.output).toMatchObject({
        echo: {
          echoed: { topic: "cross-language" },
        },
      });
    } finally {
      if (orchestrator) {
        await orchestrator.stop();
      }
      if (worker) {
        await worker.stop();
      }
      await queue.shutdown();
      await web.stop();
      await pythonRuntime.close();
    }
  });
});

async function prepareEchoAgentFixture(): Promise<string> {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-cross-language-"),
  );
  await fs.copyFile(
    path.join(FIXTURE_DIR, "echo-agent.ts"),
    path.join(trustedRuntimeRoot, "echo-agent.ts"),
  );
  return trustedRuntimeRoot;
}

async function createCrossLanguageWorkflow(
  origin: string,
  trustedRuntimeRoot: string,
  pythonEndpoint: string,
): Promise<{ readonly workflowRunId: string }> {
  const integrity = sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
  );

  const tsAgent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      key: "ts-agent",
      name: "TS Agent",
    },
  });
  const tsAgentId = (tsAgent.body as { id: string }).id;
  const tsVersion = await fetchJson(
    `${origin}/v1/agents/${tsAgentId}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: "ts-agent",
          name: "TS Agent",
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "echo-agent.ts",
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 5_000, maxAttempts: 1 },
          capabilities: { model: false, tools: [] },
        },
      },
    },
  );
  const tsAgentVersionId = (tsVersion.body as { id: string }).id;

  const pythonAgent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      key: "python-agent",
      name: "Python Agent",
    },
  });
  const pythonAgentId = (pythonAgent.body as { id: string }).id;
  const pythonVersion = await fetchJson(
    `${origin}/v1/agents/${pythonAgentId}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: "python-agent",
          name: "Python Agent",
          runtime: {
            type: "REMOTE_HTTP",
            protocolVersion: "1",
            endpoint: pythonEndpoint,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 8_000, maxAttempts: 1 },
          capabilities: { model: false, tools: [] },
        },
      },
    },
  );
  const pythonAgentVersionId = (pythonVersion.body as { id: string }).id;

  const workflow = await fetchJson(`${origin}/v1/workflows`, {
    method: "POST",
    body: {
      key: "cross-language",
      name: "Cross Language",
    },
  });
  const workflowId = (workflow.body as { id: string }).id;
  const workflowVersion = await fetchJson(
    `${origin}/v1/workflows/${workflowId}/versions`,
    {
      method: "POST",
      body: {
        definition: {
          schemaVersion: "1",
          nodes: [
            { key: "ts", type: "AGENT", agentVersionId: tsAgentVersionId },
            {
              key: "python",
              type: "AGENT",
              agentVersionId: pythonAgentVersionId,
            },
          ],
          edges: [{ from: "ts", to: "python" }],
        },
      },
    },
  );
  const workflowVersionId = (workflowVersion.body as { id: string }).id;
  const workflowRun = await fetchJson(`${origin}/v1/workflow-runs`, {
    method: "POST",
    body: {
      workflowVersionId,
      input: { topic: "cross-language" },
    },
  });

  return { workflowRunId: (workflowRun.body as { id: string }).id };
}

async function startPythonRuntimeServer(): Promise<{
  origin: string;
  close(): Promise<void>;
}> {
  const scriptPath = path.join(
    PYTHON_SDK_ROOT,
    "scripts/integration_runtime_server.py",
  );
  const child = spawn(
    "python",
    [scriptPath, "--host", "127.0.0.1", "--port", "0"],
    {
      cwd: PYTHON_SDK_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: path.join(PYTHON_SDK_ROOT, "src"),
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const origin = await new Promise<string>((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for Python runtime server startup."));
    }, 10_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const line = stdout
        .split("\n")
        .map((value) => value.trim())
        .find((value) => value.startsWith("{"));
      if (line === undefined) {
        return;
      }
      try {
        const parsed = JSON.parse(line) as { host?: string; port?: number };
        if (parsed.host !== undefined && parsed.port !== undefined) {
          clearTimeout(timer);
          resolve(`http://${parsed.host}:${String(parsed.port)}`);
        }
      } catch {
        // keep waiting
      }
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Python runtime server exited early with code ${String(code)}.`,
        ),
      );
    });
  });

  return {
    origin,
    close: async () => {
      if (child.exitCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
      });
    },
  };
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error("Timed out waiting for cross-language workflow completion.");
}
