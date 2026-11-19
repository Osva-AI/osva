import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva-ai/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva-ai/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import {
  PostgresApiKeyRepository,
  PostgresWorkspaceRepository,
} from "@osva/db";
import { Workspace, createApiKeyApplication } from "@osva/domain";

import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import {
  bootstrapIntegrationAuth,
  fetchJson,
  integrationAuth,
} from "./integration-auth.js";
import { createWebProcess } from "../../../../apps/web/src/process.js";
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

const WORKSPACE_ID = "ws-live-stream" as WorkspaceId;
const WORKSPACE_B = "ws-live-b" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

interface SseMessage {
  readonly event: string;
  readonly data: unknown;
}

describe("run live stream cross-process integration", () => {
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

  async function seedLiveStreamHarness(options: {
    readonly fixtureName: string;
    readonly agentKey: string;
    readonly fakeOpenAI: Awaited<
      ReturnType<typeof startFakeOpenAIResponsesServer>
    >;
    readonly workerTextVisible?: boolean;
    readonly workerPublishingEnabled?: boolean;
    readonly webLiveStreamEnabled?: boolean;
  }) {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-live-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, options.fixtureName),
      path.join(trustedRuntimeRoot, options.fixtureName),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, options.fixtureName)),
    );

    const streamEnv = {
      OSVA_RUN_LIVE_STREAM_ENABLED: String(
        options.webLiveStreamEnabled ?? true,
      ),
    };
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        ...streamEnv,
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_RUN_LIVE_STREAM_ENABLED: String(
          options.workerPublishingEnabled ?? true,
        ),
        ...(options.workerTextVisible === true
          ? { OSVA_RUN_LIVE_STREAM_TEXT_VISIBLE: "true" }
          : {}),
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: options.fakeOpenAI.origin,
          maxRetries: 0,
        },
      },
    );

    const port = await web.listen();
    const origin = `http://127.0.0.1:${String(port)}`;

    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "primary", name: "Primary" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: "gpt-test-snapshot",
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 1_000_000,
            outputUsdMicrosPerMillionTokens: 2_000_000,
            cachedReadInputUsdMicrosPerMillionTokens: 1_000_000,
          },
        },
      },
    );
    const modelProfileVersionId = (version.body as { id: string }).id;

    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: { key: options.agentKey, name: options.agentKey },
    });
    const agentId = (agent.body as { id: string }).id;
    const agentVersion = await fetchJson(
      `${origin}/v1/agents/${agentId}/versions`,
      {
        method: "POST",
        body: {
          manifest: {
            schemaVersion: "1",
            key: options.agentKey,
            name: options.agentKey,
            runtime: {
              type: "TRUSTED_TYPESCRIPT",
              entrypoint: options.fixtureName,
              integrity,
            },
            input: { schema: {} },
            output: { schema: {} },
            execution: { timeoutMs: 12_000, maxAttempts: 1 },
            capabilities: { model: true, tools: [] },
            models: {
              primary: { modelProfileVersionId },
            },
          },
        },
      },
    );

    return {
      cleanup: async () => {
        await worker.stop();
        await web.stop();
      },
      origin,
      worker,
      agentId,
      agentVersionId: (agentVersion.body as { id: string }).id,
      modelProfileVersionId,
    };
  }

  it("scenario A: delivers viewer-safe deltas over Valkey before run completes", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const harness = await seedLiveStreamHarness({
      fixtureName: "model-stream-text-agent.ts",
      agentKey: "live-stream-text",
      fakeOpenAI,
      workerTextVisible: true,
    });

    try {
      const created = await fetchJson(`${harness.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: harness.agentId,
          agentVersionId: harness.agentVersionId,
          input: { prompt: "stream-a" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      const controller = new AbortController();
      const sseTask = readSseUntil(
        `${harness.origin}/v1/runs/${runId}/stream`,
        controller.signal,
        (messages) => {
          const live = livePayloads(messages);
          const textDeltas = live.filter(
            (envelope) =>
              (envelope.viewerEvent as { kind?: string }).kind === "TEXT_DELTA",
          );
          return (
            messages.some((m) => m.event === "ready") && textDeltas.length >= 2
          );
        },
      );

      await waitUntil(async () => {
        const messages = sseTask.snapshot();
        return messages.some((m) => m.event === "ready");
      });

      await harness.worker.start();

      const messages = await sseTask.done;
      const live = livePayloads(messages);
      const textDeltas = live
        .map((envelope) => envelope.viewerEvent as { textDelta?: string })
        .map((event) => event.textDelta)
        .filter((value): value is string => value !== undefined);

      expect(textDeltas.length).toBeGreaterThanOrEqual(2);
      expect(textDeltas.join("")).toContain("normalized");

      const sequences = live.map((envelope) => envelope.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));

      await waitUntil(async () => {
        const run = await fetchJson(`${harness.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      controller.abort();

      expect(fakeOpenAI.requests).toHaveLength(1);

      const steps = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        status: "SUCCEEDED",
        inputTokens: 120,
        outputTokens: 15,
      });
    } finally {
      await harness.cleanup();
      await fakeOpenAI.close();
    }
  });

  it("scenario B: denies cross-workspace SSE subscription", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const harness = await seedLiveStreamHarness({
      fixtureName: "model-stream-text-agent.ts",
      agentKey: "live-stream-iso",
      fakeOpenAI,
      workerTextVisible: true,
    });

    const savedToken = integrationAuth.token;

    try {
      const created = await fetchJson(`${harness.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: harness.agentId,
          agentVersionId: harness.agentVersionId,
          input: { prompt: "stream-a" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;

      await new PostgresWorkspaceRepository(database).save(
        Workspace.create({
          id: WORKSPACE_B,
          name: "Workspace B",
          createdAt: NOW,
        }),
      );
      const apiKeyApp = createApiKeyApplication({
        apiKeys: new PostgresApiKeyRepository(database),
        workspaces: new PostgresWorkspaceRepository(database),
        clock: { now: () => NOW },
        ids: { createId: () => randomUUID() },
      });
      const keyB = await apiKeyApp.createApiKey.execute({
        workspaceId: WORKSPACE_B,
        name: "live-stream-b",
        role: COMMUNITY_EDITION_ROLES.ADMIN,
      });
      if (keyB.plaintextToken === undefined) {
        throw new Error("Expected workspace B API key.");
      }
      integrationAuth.token = keyB.plaintextToken;

      const denied = await fetch(`${harness.origin}/v1/runs/${runId}/stream`, {
        headers: {
          authorization: `Bearer ${integrationAuth.token}`,
        },
      });
      expect(denied.status).toBe(404);
      const deniedBody = await denied.text();
      expect(deniedBody).not.toContain("normalized");
      expect(deniedBody).not.toContain("TEXT_DELTA");

      integrationAuth.token = savedToken;
      await harness.worker.start();
      await waitUntil(async () => {
        const run = await fetchJson(`${harness.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });
    } finally {
      integrationAuth.token = savedToken;
      await harness.cleanup();
      await fakeOpenAI.close();
    }
  });

  it("scenario C: viewer disconnect does not affect run execution", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const harness = await seedLiveStreamHarness({
      fixtureName: "model-stream-text-agent.ts",
      agentKey: "live-stream-disc",
      fakeOpenAI,
      workerTextVisible: true,
    });

    try {
      const created = await fetchJson(`${harness.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: harness.agentId,
          agentVersionId: harness.agentVersionId,
          input: { prompt: "stream-a" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      const controller = new AbortController();
      const sseTask = readSseUntil(
        `${harness.origin}/v1/runs/${runId}/stream`,
        controller.signal,
        (messages) => messages.some((m) => m.event === "ready"),
      );

      await waitUntil(async () =>
        sseTask.snapshot().some((m) => m.event === "ready"),
      );
      await harness.worker.start();
      await waitUntil(async () => {
        const steps = await fetchJson(
          `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
        );
        return (
          steps.status === 200 &&
          (steps.body as { steps: unknown[] }).steps.length > 0
        );
      }, 15_000);

      controller.abort();
      await sseTask.done.catch(() => undefined);

      await waitUntil(async () => {
        const run = await fetchJson(`${harness.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      expect(fakeOpenAI.requests).toHaveLength(1);

      const steps = await fetchJson(
        `${harness.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      expect((steps.body as { steps: unknown[] }).steps).toHaveLength(1);
    } finally {
      await harness.cleanup();
      await fakeOpenAI.close();
    }
  }, 60_000);

  it("scenario D: run succeeds when live publishing is disabled", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const harness = await seedLiveStreamHarness({
      fixtureName: "model-stream-text-agent.ts",
      agentKey: "live-stream-off",
      fakeOpenAI,
      workerPublishingEnabled: false,
      workerTextVisible: true,
    });

    try {
      const created = await fetchJson(`${harness.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: harness.agentId,
          agentVersionId: harness.agentVersionId,
          input: { prompt: "stream-a" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      await harness.worker.start();

      await waitUntil(async () => {
        const run = await fetchJson(`${harness.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      expect(fakeOpenAI.requests).toHaveLength(1);
    } finally {
      await harness.cleanup();
      await fakeOpenAI.close();
    }
  });

  it("scenario E: unsafe model events do not leak through SSE", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const harness = await seedLiveStreamHarness({
      fixtureName: "model-stream-tool-agent.ts",
      agentKey: "live-stream-tool",
      fakeOpenAI,
      workerTextVisible: false,
    });

    const controller = new AbortController();

    try {
      const created = await fetchJson(`${harness.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: harness.agentId,
          agentVersionId: harness.agentVersionId,
          input: { prompt: "stream-b" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;

      const sseTask = readSseUntil(
        `${harness.origin}/v1/runs/${runId}/stream`,
        controller.signal,
        (messages) =>
          livePayloads(messages).some(
            (envelope) =>
              (envelope.viewerEvent as { status?: string }).status === "ended",
          ),
      );

      await waitUntil(async () =>
        sseTask.snapshot().some((m) => m.event === "ready"),
      );
      await harness.worker.start();
      await sseTask.done;

      const payloads = livePayloads(sseTask.snapshot());
      const serialized = JSON.stringify(payloads);
      expect(serialized).not.toContain("declarative-tool-input");
      expect(serialized).not.toContain("TOOL_CALL");
      expect(serialized).not.toContain("argumentsDelta");
      expect(
        payloads.some(
          (envelope) =>
            (envelope.viewerEvent as { kind?: string }).kind ===
            "STREAM_STATUS",
        ),
      ).toBe(true);
    } finally {
      controller.abort();
      await harness.cleanup();
      await fakeOpenAI.close();
    }
  });
});

function livePayloads(messages: readonly SseMessage[]) {
  return messages
    .filter((message) => message.event === "run-live")
    .map((message) => message.data as LiveEnvelope);
}

interface LiveEnvelope {
  readonly sequence: number;
  readonly viewerEvent: unknown;
  readonly workspaceId?: string;
  readonly runId?: string;
}

function readSseUntil(
  url: string,
  signal: AbortSignal,
  until: (messages: SseMessage[]) => boolean,
) {
  const messages: SseMessage[] = [];
  let resolveDone: (messages: SseMessage[]) => void;
  let rejectDone: (error: unknown) => void;
  const done = new Promise<SseMessage[]>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const headers: Record<string, string> = {};
  if (integrationAuth.token.length > 0) {
    headers.authorization = `Bearer ${integrationAuth.token}`;
  }

  void (async () => {
    try {
      const response = await fetch(url, { headers, signal });
      if (!response.ok) {
        throw new Error(
          `SSE request failed with status ${String(response.status)}`,
        );
      }
      const reader = response.body?.getReader();
      if (reader === undefined) {
        throw new Error("SSE response had no body.");
      }
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done: readDone, value } = await reader.read();
        if (readDone) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        buffer = drainSseBuffer(buffer, messages, until, resolveDone);
        if (until(messages)) {
          resolveDone(messages);
          return;
        }
      }
      resolveDone(messages);
    } catch (error) {
      if (signal.aborted) {
        resolveDone(messages);
        return;
      }
      rejectDone(error);
    }
  })();

  return {
    done,
    snapshot: () => [...messages],
  };
}

function drainSseBuffer(
  buffer: string,
  messages: SseMessage[],
  until: (messages: SseMessage[]) => boolean,
  resolveDone: (messages: SseMessage[]) => void,
): string {
  let remaining = buffer;
  while (true) {
    const split = remaining.indexOf("\n\n");
    if (split < 0) {
      return remaining;
    }
    const block = remaining.slice(0, split);
    remaining = remaining.slice(split + 2);
    const parsed = parseSseBlock(block);
    if (parsed !== undefined) {
      messages.push(parsed);
      if (until(messages)) {
        resolveDone(messages);
        return remaining;
      }
    }
  }
}

function parseSseBlock(block: string): SseMessage | undefined {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) {
    return undefined;
  }
  return {
    event,
    data: JSON.parse(dataLines.join("\n")) as unknown,
  };
}

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for live stream condition.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
