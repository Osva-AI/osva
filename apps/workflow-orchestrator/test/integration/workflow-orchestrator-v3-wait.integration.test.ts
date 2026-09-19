import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunId, WorkspaceId } from "@osva/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  PostgresWorkflowRunRepository,
  PostgresWorkflowWaitRepository,
  PostgresWorkspaceRepository,
  createDatabase,
  migrateDatabase,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";

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

const WORKSPACE_ID = "ws-v3-wait-e2e" as WorkspaceId;
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);
describe("workflow orchestrator V3 WAIT end-to-end", () => {
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
    await new PostgresWorkspaceRepository(database).save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Workspace",
        createdAt: new Date(),
      }),
    );
  });

  it("completes AGENT -> WAIT DURATION -> AGENT through timer driver and reconciliation", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const queue = new BullMqJobQueue({ url: valkey.url });
    const { web, worker, orchestrator, origin, agentVersionId } =
      await startStack(trustedRuntimeRoot, queue);

    try {
      const registered = await createV3WorkflowRun(origin, {
        nodes: [
          { key: "a", type: "AGENT", agentVersionId },
          {
            key: "delay",
            type: "WAIT",
            wait: { kind: "DURATION", durationMs: 100 },
          },
          { key: "b", type: "AGENT", agentVersionId },
        ],
        edges: [
          { from: "a", to: "delay" },
          { from: "delay", to: "b" },
        ],
        input: { campaign: "launch" },
      });

      const workflowRuns = new PostgresWorkflowRunRepository(database);
      const waits = new PostgresWorkflowWaitRepository(database);

      await waitUntil(async () => {
        await orchestrator.tickOnce();
        const view = await loadRun(origin, registered.workflowRunId);
        const armed = await waits.listWorkflowWaitsByWorkflowRunId(
          registered.workflowRunId,
        );
        return view.byKey.delay?.status === "WAITING" && armed.length === 1;
      });

      const armed = await waits.listWorkflowWaitsByWorkflowRunId(
        registered.workflowRunId,
      );
      expect(armed).toHaveLength(1);
      expect(armed[0]!.armedAt.toISOString()).toBe(
        (await workflowRuns.listWorkflowNodeRuns(registered.workflowRunId))
          .find((node) => node.workflowNodeKey === "delay")
          ?.startedAt?.toISOString(),
      );

      await new Promise((resolve) => setTimeout(resolve, 150));
      await waitUntil(async () => {
        await orchestrator.tickOnce();
        const view = await workflowRuns.findWorkflowRunById(
          registered.workflowRunId,
        );
        return view?.status === "SUCCEEDED";
      });

      const done = await loadRun(origin, registered.workflowRunId);
      expect(done.byKey.delay?.status).toBe("SUCCEEDED");
      expect(done.byKey.delay?.output).toEqual(done.byKey.delay?.input);
      expect(done.byKey.delay?.childRunId).toBeUndefined();
      expect(done.byKey.b?.status).toBe("SUCCEEDED");
      const resolved = (
        await waits.listWorkflowWaitsByWorkflowRunId(registered.workflowRunId)
      )[0];
      expect(resolved?.resolution).toBe("TIMER");
    } finally {
      await stopStack(web, worker, orchestrator, queue);
    }
  });

  it("resolves an early persisted EVENT after WAIT arms on a later tick", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const queue = new BullMqJobQueue({ url: valkey.url });
    const { web, worker, orchestrator, origin, agentVersionId } =
      await startStack(trustedRuntimeRoot, queue);

    try {
      const registered = await createV3WorkflowRun(origin, {
        nodes: [
          {
            key: "delay",
            type: "WAIT",
            wait: {
              kind: "EVENT",
              source: "billing",
              eventType: "invoice.paid",
              correlation: { kind: "LITERAL", value: "ord-early" },
            },
          },
          { key: "b", type: "AGENT", agentVersionId },
        ],
        edges: [{ from: "delay", to: "b" }],
        input: { orderId: "ord-early" },
      });

      const ingested = await fetchJson(`${origin}/v1/workflow-events`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          source: "billing",
          eventType: "invoice.paid",
          correlationKey: "ord-early",
          idempotencyKey: "early-event-1",
          payload: { ignored: true },
        },
      });
      expect(ingested.status).toBe(200);
      const eventId = (ingested.body as { id: string }).id;

      const waits = new PostgresWorkflowWaitRepository(database);
      await waitUntil(async () => {
        await orchestrator.tickOnce();
        const view = await loadRun(origin, registered.workflowRunId);
        const armed = await waits.listWorkflowWaitsByWorkflowRunId(
          registered.workflowRunId,
        );
        return view.byKey.delay?.status === "WAITING" && armed.length === 1;
      });

      await waitUntil(async () => {
        await orchestrator.tickOnce();
        const view = await loadRun(origin, registered.workflowRunId);
        return view.status === "SUCCEEDED";
      });

      const stored = (
        await waits.listWorkflowWaitsByWorkflowRunId(registered.workflowRunId)
      )[0];
      expect(stored?.resolution).toBe("EVENT");
      expect(stored?.resolvedByEventId).toBe(eventId);

      const done = await loadRun(origin, registered.workflowRunId);
      expect(done.byKey.delay?.output).toEqual(done.byKey.delay?.input);
      expect(done.byKey.b?.status).toBe("SUCCEEDED");
    } finally {
      await stopStack(web, worker, orchestrator, queue);
    }
  });

  it("fails EVENT waits on timeout without starting the successor agent", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const queue = new BullMqJobQueue({ url: valkey.url });
    const { web, worker, orchestrator, origin, agentVersionId } =
      await startStack(trustedRuntimeRoot, queue);

    try {
      const registered = await createV3WorkflowRun(origin, {
        nodes: [
          {
            key: "delay",
            type: "WAIT",
            wait: {
              kind: "EVENT",
              source: "billing",
              eventType: "invoice.paid",
              correlation: { kind: "LITERAL", value: "ord-timeout" },
              timeoutMs: 100,
            },
          },
          { key: "b", type: "AGENT", agentVersionId },
        ],
        edges: [{ from: "delay", to: "b" }],
        input: {},
      });

      const waits = new PostgresWorkflowWaitRepository(database);
      await waitUntil(async () => {
        await orchestrator.tickOnce();
        const view = await loadRun(origin, registered.workflowRunId);
        const armed = await waits.listWorkflowWaitsByWorkflowRunId(
          registered.workflowRunId,
        );
        return view.byKey.delay?.status === "WAITING" && armed.length === 1;
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      await waitUntil(async () => {
        await orchestrator.tickOnce();
        const view = await loadRun(origin, registered.workflowRunId);
        return view.status === "FAILED";
      });

      const failed = await loadRun(origin, registered.workflowRunId);
      expect(failed.byKey.delay?.error?.code).toBe("WORKFLOW_EVENT_TIMEOUT");
      expect(failed.byKey.b).toBeUndefined();
    } finally {
      await stopStack(web, worker, orchestrator, queue);
    }
  });

  async function startStack(trustedRuntimeRoot: string, queue: BullMqJobQueue) {
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
    const port = await web.listen();
    const origin = `http://127.0.0.1:${String(port)}`;
    const agentVersionId = await registerEchoAgent(origin, trustedRuntimeRoot);
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      { queueFactory: () => queue },
    );
    const orchestrator = createWorkflowOrchestratorProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      { queueFactory: () => queue },
    );
    await worker.start();
    return { web, worker, orchestrator, origin, agentVersionId };
  }
});

async function stopStack(
  web: ReturnType<typeof createWebProcess>,
  worker: ReturnType<typeof createWorkerProcess>,
  orchestrator: ReturnType<typeof createWorkflowOrchestratorProcess>,
  queue: BullMqJobQueue,
) {
  await orchestrator.stop();
  await worker.stop();
  await queue.shutdown();
  await web.stop();
}

async function createV3WorkflowRun(
  origin: string,
  input: {
    readonly nodes: unknown[];
    readonly edges: ReadonlyArray<{ from: string; to: string }>;
    readonly input: unknown;
  },
): Promise<{ readonly workflowRunId: WorkflowRunId }> {
  const workflow = await fetchJson(`${origin}/v1/workflows`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: `v3-${String(Date.now())}`,
      name: "V3 Wait",
    },
  });
  const workflowVersion = await fetchJson(
    `${origin}/v1/workflows/${(workflow.body as { id: string }).id}/versions`,
    {
      method: "POST",
      body: {
        definition: {
          schemaVersion: "3",
          nodes: input.nodes,
          edges: input.edges,
        },
      },
    },
  );
  const workflowRun = await fetchJson(`${origin}/v1/workflow-runs`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      workflowVersionId: (workflowVersion.body as { id: string }).id,
      input: input.input,
    },
  });
  return {
    workflowRunId: (workflowRun.body as { id: WorkflowRunId }).id,
  };
}

async function registerEchoAgent(
  origin: string,
  trustedRuntimeRoot: string,
): Promise<string> {
  const integrity = sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
  );
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: "echo-agent",
      name: "Echo Agent",
    },
  });
  const version = await fetchJson(
    `${origin}/v1/agents/${(agent.body as { id: string }).id}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: "echo-agent",
          name: "Echo Agent",
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "echo-agent.ts",
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 30_000, maxAttempts: 2 },
          capabilities: { model: false, tools: [] },
        },
      },
    },
  );
  return (version.body as { id: string }).id;
}

async function loadRun(origin: string, workflowRunId: WorkflowRunId) {
  const loaded = await fetchJson(`${origin}/v1/workflow-runs/${workflowRunId}`);
  const body = loaded.body as {
    status: string;
    nodeRuns: ReadonlyArray<{
      workflowNodeKey: string;
      status: string;
      input?: unknown;
      output?: unknown;
      childRunId?: string;
      error?: { code: string };
    }>;
  };
  return {
    status: body.status,
    byKey: Object.fromEntries(
      body.nodeRuns.map((node) => [node.workflowNodeKey, node]),
    ),
  };
}

async function prepareEchoAgentFixture(): Promise<string> {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "osva-echo-"));
  await fs.copyFile(
    path.join(FIXTURE_DIR, "echo-agent.ts"),
    path.join(target, "echo-agent.ts"),
  );
  return target;
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for workflow orchestrator execution.");
}

async function fetchJson(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: response.status, body: await response.json() };
}
