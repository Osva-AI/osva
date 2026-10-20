import fs from "node:fs/promises";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolVersionId, WorkspaceId } from "@osva-ai/contracts";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";

import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
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

const WORKSPACE_ID = "ws-declarative" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

const OUTPUT_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

describe("declarative runtime end-to-end", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let trustedRuntimeRoot: string;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);

    trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-declarative-e2e-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "echo-agent.ts"),
      path.join(trustedRuntimeRoot, "echo-agent.ts"),
    );
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

  it("executes DECLARATIVE runs with persisted output, RunSteps, and usage", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startDeclarativeStack(
      postgres,
      valkey,
      trustedRuntimeRoot,
      fakeOpenAI.origin,
    );

    try {
      const { modelProfileVersionId, agentId } = await seedModelProfile(
        stack.origin,
      );

      const agentVersion = await createDeclarativeAgentVersion(stack.origin, {
        agentId,
        modelProfileVersionId,
        allowedToolBindings: [],
        toolCapabilities: [],
        toolVersionBindings: {},
      });
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { question: "declarative-model-only" },
        },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: { answer: "declarative-ok" },
      });

      const steps = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      expect(steps.status).toBe(200);
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        bindingName: "primary",
        status: "SUCCEEDED",
        modelProfileVersionId,
        inputTokens: 120,
        outputTokens: 15,
      });
    } finally {
      await stack.stop();
      await fakeOpenAI.close();
    }
  });

  it("runs model → tool → model with tool RunSteps", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startDeclarativeStack(
      postgres,
      valkey,
      trustedRuntimeRoot,
      fakeOpenAI.origin,
    );

    try {
      const { modelProfileVersionId, agentId } = await seedModelProfile(
        stack.origin,
      );

      const tool = await fetchJson(`${stack.origin}/v1/tools`, {
        method: "POST",
        body: { key: "echo", name: "Echo" },
      });
      const toolId = (tool.body as { id: string }).id;
      const toolVersion = await fetchJson(
        `${stack.origin}/v1/tools/${toolId}/versions`,
        {
          method: "POST",
          body: { type: "INTERNAL", implementation: "OSVA_ECHO_V1" },
        },
      );
      const toolVersionId = (toolVersion.body as { id: ToolVersionId }).id;

      const agentVersion = await createDeclarativeAgentVersion(stack.origin, {
        agentId,
        modelProfileVersionId,
        allowedToolBindings: ["echo"],
        toolCapabilities: ["echo"],
        toolVersionBindings: { echo: toolVersionId },
      });
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { scenario: "declarative-tool-flow" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: { answer: "declarative-after-tool" },
      });

      const steps = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const kinds = (
        steps.body as { steps: Array<{ kind: string; status: string }> }
      ).steps.map((step) => step.kind);
      expect(kinds).toEqual(["MODEL", "TOOL", "MODEL"]);
      expect(
        (steps.body as { steps: Array<Record<string, unknown>> }).steps.every(
          (step) => step.status === "SUCCEEDED",
        ),
      ).toBe(true);
    } finally {
      await stack.stop();
      await fakeOpenAI.close();
    }
  });

  it("fails closed when the model requests a tool outside allowedToolBindings", async () => {
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startDeclarativeStack(
      postgres,
      valkey,
      trustedRuntimeRoot,
      fakeOpenAI.origin,
    );

    try {
      const { modelProfileVersionId, agentId } = await seedModelProfile(
        stack.origin,
      );

      const tool = await fetchJson(`${stack.origin}/v1/tools`, {
        method: "POST",
        body: { key: "echo", name: "Echo" },
      });
      const toolId = (tool.body as { id: string }).id;
      const toolVersion = await fetchJson(
        `${stack.origin}/v1/tools/${toolId}/versions`,
        {
          method: "POST",
          body: { type: "INTERNAL", implementation: "OSVA_ECHO_V1" },
        },
      );
      const toolVersionId = (toolVersion.body as { id: ToolVersionId }).id;

      const agentVersion = await createDeclarativeAgentVersion(stack.origin, {
        agentId,
        modelProfileVersionId,
        allowedToolBindings: ["echo"],
        toolCapabilities: ["echo"],
        toolVersionBindings: { echo: toolVersionId },
      });
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { scenario: "declarative-unauthorized" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "FAILED";
      });

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "FAILED",
        error: { code: "TOOL_NOT_AUTHORIZED" },
      });
    } finally {
      await stack.stop();
      await fakeOpenAI.close();
    }
  });
});

async function startDeclarativeStack(
  postgres: PostgresTestContext,
  valkey: ValkeyTestContext,
  trustedRuntimeRoot: string,
  fakeOpenAiOrigin: string,
) {
  const web = createWebProcess(
    withTestAuthEnv({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    }),
  );
  const worker = createWorkerProcess(
    {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
    },
    (connectionString) => createDatabase({ connectionString, max: 5 }),
    {
      openai: {
        apiKey: "test-key",
        baseURL: fakeOpenAiOrigin,
        maxRetries: 0,
      },
    },
  );

  const port = await web.listen();
  await worker.start();
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    async stop() {
      await worker.stop();
      await web.stop();
    },
  };
}

async function seedModelProfile(origin: string) {
  const profile = await fetchJson(`${origin}/v1/model-profiles`, {
    method: "POST",
    body: { key: "primary", name: "Primary" },
  });
  expect(profile.status).toBe(201);
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
        },
      },
    },
  );
  expect(version.status).toBe(201);
  const modelProfileVersionId = (version.body as { id: string }).id;

  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: { key: "declarative-agent", name: "Declarative Agent" },
  });
  expect(agent.status).toBe(201);

  return {
    modelProfileVersionId,
    agentId: (agent.body as { id: string }).id,
  };
}

async function createDeclarativeAgentVersion(
  origin: string,
  input: {
    readonly agentId: string;
    readonly modelProfileVersionId: string;
    readonly allowedToolBindings: readonly string[];
    readonly toolCapabilities: readonly string[];
    readonly toolVersionBindings: Record<string, string>;
  },
) {
  const toolsBlock =
    Object.keys(input.toolVersionBindings).length === 0
      ? {}
      : {
          tools: Object.fromEntries(
            Object.entries(input.toolVersionBindings).map(([name, id]) => [
              name,
              { toolVersionId: id },
            ]),
          ),
        };

  const maxToolInvocations = input.allowedToolBindings.length === 0 ? 0 : 4;

  const versionResponse = await fetchJson(
    `${origin}/v1/agents/${input.agentId}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: "declarative-agent",
          name: "Declarative Agent",
          runtime: {
            type: "DECLARATIVE",
            config: {
              configVersion: "1",
              instructions: "Answer using tools only when allowed.",
              modelBinding: "primary",
              allowedToolBindings: input.allowedToolBindings,
              maxModelInvocations: 4,
              maxToolInvocations,
              maxOutputTokens: 512,
            },
          },
          input: { schema: { type: "object" } },
          output: { schema: OUTPUT_SCHEMA },
          execution: { timeoutMs: 15_000, maxAttempts: 1 },
          capabilities: {
            model: true,
            tools: input.toolCapabilities,
          },
          models: {
            primary: { modelProfileVersionId: input.modelProfileVersionId },
          },
          ...toolsBlock,
        },
      },
    },
  );
  expect(versionResponse.status).toBe(201);
  return versionResponse;
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 45_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for condition.");
}
