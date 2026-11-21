/**
 * Live LiteLLM proxy acceptance (L1–L10). Skipped unless OSVA_LITELLM_LIVE_ACCEPTANCE=1.
 * Run: pnpm acceptance:litellm
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import type { WorkspaceId } from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresRunRepository,
  type Database,
} from "@osva/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import { createWebProcess } from "../../../../apps/web/src/process.js";
import { createWorkerProcess } from "../../src/process.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
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
  activateRoutingPolicy,
  listReservations,
  seedInferenceBudgetPolicy,
  waitUntil as waitUntilBudget,
} from "./inference-budget-worker-harness.js";
import {
  litellmConnectionEndpoint,
  LITELLM_ACCEPTANCE_MASTER_KEY,
  providerModelCounts,
  startLitellmLiveStack,
  waitUntil,
  type LitellmLiveStack,
} from "./litellm-live-proxy-harness.js";

const LIVE = process.env.OSVA_LITELLM_LIVE_ACCEPTANCE === "1";
const WORKSPACE = "ws-litellm-live" as WorkspaceId;
const NOW = new Date("2026-03-01T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe.skipIf(!LIVE)("LiteLLM live proxy acceptance (L1–L10)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let litellm: LitellmLiveStack;

  beforeAll(async () => {
    litellm = await startLitellmLiveStack();
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
    });
    await migrateDatabase(database);
  }, 240_000);

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
    if (litellm) {
      await litellm.teardown();
    }
  }, 120_000);

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE, NOW);
    litellm.fakeOpenAI.requests.length = 0;
  });

  async function seedStack(options?: {
    readonly credentialEnvValue?: string;
    readonly stream?: boolean;
    readonly streamFail?: boolean;
  }) {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-litellm-live-"),
    );
    const fixture = options?.streamFail
      ? "model-stream-fail-agent.ts"
      : options?.stream
        ? "model-stream-text-agent.ts"
        : "model-text-agent.ts";
    await fs.copyFile(
      path.join(FIXTURE_DIR, fixture),
      path.join(trustedRuntimeRoot, fixture),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, fixture)),
    );
    const credential =
      options?.credentialEnvValue ?? LITELLM_ACCEPTANCE_MASTER_KEY;
    const env = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      OPENAI_API_KEY: credential,
    };
    const proxyV1 = litellmConnectionEndpoint(litellm.proxyBaseUrl);
    const web = createWebProcess(withTestAuthEnv(env));
    const worker = createWorkerProcess(
      { ...env, OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: credential,
          baseURL: proxyV1,
          maxRetries: 0,
        },
      },
    );
    const inspector = new BullMqJobQueue({ url: valkey.url });
    const port = await web.listen();
    await worker.start();
    const origin = `http://127.0.0.1:${String(port)}`;

    const connection = await fetchJson(
      `${origin}/v1/model-provider-connections`,
      {
        method: "POST",
        body: {
          key: "litellm-gateway",
          name: "LiteLLM Gateway",
          provider: "OPENAI",
        },
      },
    );
    const connectionId = (connection.body as { id: string }).id;
    const connectionVersion = await fetchJson(
      `${origin}/v1/model-provider-connections/${connectionId}/versions`,
      {
        method: "POST",
        body: {
          endpoint: {
            baseUrl: proxyV1,
            allowPrivateNetworks: true,
          },
          credentialRef: { key: "OPENAI_API_KEY" },
        },
      },
    );
    const connectionVersionId = (connectionVersion.body as { id: string }).id;

    async function createModelVersion(input: {
      readonly key: string;
      readonly model: string;
    }) {
      const profile = await fetchJson(`${origin}/v1/model-profiles`, {
        method: "POST",
        body: { key: input.key, name: input.key },
      });
      const version = await fetchJson(
        `${origin}/v1/model-profiles/${(profile.body as { id: string }).id}/versions`,
        {
          method: "POST",
          body: {
            provider: "OPENAI",
            model: input.model,
            modelProviderConnectionVersionId: connectionVersionId,
            pricing: {
              currency: "USD",
              inputUsdMicrosPerMillionTokens: 1_000_000,
              outputUsdMicrosPerMillionTokens: 2_000_000,
            },
          },
        },
      );
      return (version.body as { id: string }).id;
    }

    const primaryModelProfileVersionId = await createModelVersion({
      key: "litellm-primary",
      model:
        options?.stream || options?.streamFail
          ? "gpt-test-snapshot"
          : "osva-litellm-primary",
    });

    const agentKey = options?.streamFail
      ? "model-stream-fail-agent"
      : options?.stream
        ? "model-stream-text-agent"
        : "model-text-agent";
    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: { key: agentKey, name: agentKey },
    });
    const agentId = (agent.body as { id: string }).id;
    const agentVersion = await fetchJson(
      `${origin}/v1/agents/${agentId}/versions`,
      {
        method: "POST",
        body: {
          manifest: {
            schemaVersion: "1",
            key: agentKey,
            name: agentKey,
            runtime: {
              type: "TRUSTED_TYPESCRIPT",
              entrypoint: fixture,
              integrity,
            },
            input: { schema: {} },
            output: { schema: {} },
            execution: {
              timeoutMs: options?.stream ? 15_000 : 8_000,
              maxAttempts: 1,
            },
            capabilities: { model: true, tools: [] },
            models: {
              primary: { modelProfileVersionId: primaryModelProfileVersionId },
            },
          },
        },
      },
    );

    return {
      origin,
      worker,
      web,
      inspector,
      agentId,
      agentVersionId: (agentVersion.body as { id: string }).id,
      connectionId,
      connectionVersionId,
      primaryModelProfileVersionId,
      createModelVersion,
      async shutdown() {
        await worker.stop();
        await inspector.shutdown();
        await web.stop();
      },
    };
  }

  it("L0/L1: connection lifecycle, test call, and non-streaming run via LiteLLM", async () => {
    const stack = await seedStack();
    try {
      const test = await fetchJson(
        `${stack.origin}/v1/model-provider-connections/${stack.connectionId}/versions/${stack.connectionVersionId}/test`,
        {
          method: "POST",
          body: { model: "osva-litellm-primary" },
        },
      );
      expect(test.status).toBe(200);
      expect(JSON.stringify(test.body)).not.toContain(
        LITELLM_ACCEPTANCE_MASTER_KEY,
      );

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "litellm-l1" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      expect(litellm.fakeOpenAI.requests.length).toBeGreaterThanOrEqual(1);
      const steps = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const modelStep = (
        steps.body as { steps: Array<Record<string, unknown>> }
      ).steps[0];
      expect(modelStep).toMatchObject({
        kind: "MODEL",
        status: "SUCCEEDED",
      });
      expect(modelStep?.inputTokens).toBeGreaterThan(0);
    } finally {
      await stack.shutdown();
    }
  }, 120_000);

  it("L2: streaming generation via LiteLLM", async () => {
    const stack = await seedStack({ stream: true });
    const upstreamBefore = litellm.fakeOpenAI.requests.length;
    try {
      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "routing-stream-litellm" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      const upstreamSlice = litellm.fakeOpenAI.requests.slice(upstreamBefore);
      expect(upstreamSlice.length).toBe(1);
      const streamRequests = upstreamSlice.filter(
        (request) =>
          request.body !== null &&
          typeof request.body === "object" &&
          (request.body as { stream?: boolean }).stream === true,
      );
      expect(streamRequests).toHaveLength(1);

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          text: "normalized text from fake openai",
          deltas: expect.arrayContaining([expect.any(String)]),
        },
      });
      expect(
        (attempt.body as { output: { deltas: string[] } }).output.deltas.length,
      ).toBeGreaterThanOrEqual(1);

      const steps = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const stepList = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps;
      expect(stepList).toHaveLength(1);
      expect(stepList[0]).toMatchObject({
        kind: "MODEL",
        bindingName: "primary",
        status: "SUCCEEDED",
        inputTokens: 120,
        outputTokens: 15,
        providerRequestId: expect.any(String),
        usageIncomplete: false,
      });
    } finally {
      await stack.shutdown();
    }
  }, 120_000);

  it("L3: invalid proxy credential is rejected without secret leakage", async () => {
    const stack = await seedStack({
      credentialEnvValue: "sk-wrong-litellm-credential",
    });
    try {
      const test = await fetchJson(
        `${stack.origin}/v1/model-provider-connections/${stack.connectionId}/versions/${stack.connectionVersionId}/test`,
        {
          method: "POST",
          body: { model: "osva-litellm-primary" },
        },
      );
      expect(test.status).toBe(200);
      expect((test.body as { status?: string }).status).toBe("FAILED");
      const text = JSON.stringify(test.body);
      expect(text).not.toContain("sk-wrong-litellm-credential");
    } finally {
      await stack.shutdown();
    }
  }, 120_000);

  it("L4: unknown LiteLLM model alias returns classified failure", async () => {
    const stack = await seedStack();
    try {
      const test = await fetchJson(
        `${stack.origin}/v1/model-provider-connections/${stack.connectionId}/versions/${stack.connectionVersionId}/test`,
        {
          method: "POST",
          body: { model: "osva-unknown-alias-not-in-config" },
        },
      );
      expect(test.status).toBe(200);
      expect((test.body as { status?: string }).status).toBe("FAILED");
      expect(JSON.stringify(test.body)).not.toContain(
        LITELLM_ACCEPTANCE_MASTER_KEY,
      );
    } finally {
      await stack.shutdown();
    }
  }, 120_000);

  it("L5: usage and cost estimates persist on MODEL RunStep", async () => {
    const stack = await seedStack();
    try {
      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "litellm-l5" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });
      const steps = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}/steps`,
      );
      const step = (steps.body as { steps: Array<Record<string, unknown>> })
        .steps[0];
      expect(step?.outputTokens).toBeGreaterThan(0);
      const cost = step?.estimatedCostUsdMicros;
      const costMicros =
        typeof cost === "number" ? cost : Number(cost ?? Number.NaN);
      if (Number.isFinite(costMicros)) {
        expect(costMicros).toBeGreaterThan(0);
      } else {
        expect(step?.totalTokens).toBeGreaterThan(0);
      }
    } finally {
      await stack.shutdown();
    }
  }, 120_000);

  it("L6: routing policy selects LiteLLM-backed profile", async () => {
    const stack = await seedStack();
    try {
      const routed = await stack.createModelVersion({
        key: "litellm-routed",
        model: "gpt-routing-test",
      });
      await activateRoutingPolicy(stack.origin, {
        key: "litellm-fixed",
        definition: {
          schemaVersion: "1",
          strategy: "FIXED",
          candidateModelProfileVersionIds: [routed],
          preferredModelProfileVersionId: routed,
          maxProviderAttempts: 1,
        },
      });
      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "routing-acceptance" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });
      expect(litellm.fakeOpenAI.requests.length).toBeGreaterThanOrEqual(1);
    } finally {
      await stack.shutdown();
    }
  }, 120_000);

  it("L7: pre-output retryable failure falls back through LiteLLM", async () => {
    const stack = await seedStack();
    try {
      const fail = await stack.createModelVersion({
        key: "litellm-fail",
        model: "gpt-routing-retry-429",
      });
      const cheap = await stack.createModelVersion({
        key: "litellm-cheap",
        model: "gpt-routing-cheap",
      });
      await activateRoutingPolicy(stack.origin, {
        key: "litellm-fallback",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [fail, cheap],
          allowFallback: true,
          maxProviderAttempts: 2,
        },
      });
      const before = litellm.fakeOpenAI.requests.length;
      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "routing-acceptance" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });
      const counts = providerModelCounts(
        litellm.fakeOpenAI.requests.slice(before),
      );
      expect(counts.get("gpt-routing-retry-429")).toBe(1);
      expect(counts.get("gpt-routing-cheap")).toBe(1);
    } finally {
      await stack.shutdown();
    }
  }, 150_000);

  it("L8: mid-stream failure does not switch models", async () => {
    const stack = await seedStack({ streamFail: true });
    try {
      const failModel = await stack.createModelVersion({
        key: "stream-fail",
        model: "gpt-test-snapshot",
      });
      const fallback = await stack.createModelVersion({
        key: "stream-fallback",
        model: "gpt-routing-cheap",
      });
      await activateRoutingPolicy(stack.origin, {
        key: "litellm-stream-fail",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [failModel, fallback],
          allowFallback: true,
          maxProviderAttempts: 2,
        },
      });
      const before = litellm.fakeOpenAI.requests.length;
      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "routing-stream-r8" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        const status = (run.body as { status?: string }).status;
        return (
          run.status === 200 && (status === "FAILED" || status === "SUCCEEDED")
        );
      });
      const counts = providerModelCounts(
        litellm.fakeOpenAI.requests.slice(before),
      );
      expect(counts.get("gpt-routing-cheap") ?? 0).toBe(0);
    } finally {
      await stack.shutdown();
    }
  }, 150_000);

  it("L9: B5 budget reservations for separate provider attempts", async () => {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: WORKSPACE,
      enabled: true,
      periodLimitUsdMicros: 500_000_000,
      now: NOW,
    });

    const stack = await seedStack();
    try {
      const fail = await stack.createModelVersion({
        key: "budget-fail",
        model: "gpt-routing-retry-429",
      });
      const cheap = await stack.createModelVersion({
        key: "budget-cheap",
        model: "gpt-routing-cheap",
      });
      await activateRoutingPolicy(stack.origin, {
        key: "litellm-budget",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [fail, cheap],
          allowFallback: true,
          maxProviderAttempts: 2,
        },
      });
      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: stack.agentId,
          agentVersionId: stack.agentVersionId,
          input: { prompt: "routing-acceptance" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });
      await waitUntilBudget(async () => {
        const rows = await listReservations(database, WORKSPACE);
        return rows.length >= 2;
      });
      const rows = await listReservations(database, WORKSPACE);
      const statuses = rows.map((row) => row.status).sort();
      expect(statuses.length).toBeGreaterThanOrEqual(2);
      expect(
        statuses.every((status) =>
          ["COMMITTED", "RECONCILIATION_REQUIRED", "RELEASED"].includes(status),
        ),
      ).toBe(true);
    } finally {
      await stack.shutdown();
    }
  }, 180_000);

  it("L10: OSVA attempt accounting vs proxy retry risk route", async () => {
    const stack = await seedStack();
    try {
      const riskProfile = await stack.createModelVersion({
        key: "proxy-retry-risk",
        model: "litellm-proxy-retry-risk",
      });
      const runs = new PostgresRunRepository(database);
      const profile = await fetchJson(`${stack.origin}/v1/model-profiles`, {
        method: "POST",
        body: { key: "retry-risk-agent-profile", name: "risk" },
      });
      void profile;
      const agent = await fetchJson(`${stack.origin}/v1/agents`, {
        method: "POST",
        body: { key: "retry-risk-agent", name: "risk" },
      });
      const agentId = (agent.body as { id: string }).id;
      const trustedRuntimeRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "osva-litellm-risk-"),
      );
      const fixture = "model-text-agent.ts";
      await fs.copyFile(
        path.join(FIXTURE_DIR, fixture),
        path.join(trustedRuntimeRoot, fixture),
      );
      const integrity = sha256IntegrityOf(
        await fs.readFile(path.join(trustedRuntimeRoot, fixture)),
      );
      const agentVersion = await fetchJson(
        `${stack.origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "retry-risk-agent",
              name: "retry-risk-agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: fixture,
                integrity,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 8_000, maxAttempts: 1 },
              capabilities: { model: true, tools: [] },
              models: { primary: { modelProfileVersionId: riskProfile } },
            },
          },
        },
      );
      const before = litellm.fakeOpenAI.requests.length;
      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId: (agentVersion.body as { id: string }).id,
          input: { prompt: "litellm-l10" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;
      let terminal = "RUNNING";
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        if (run.status === 200) {
          terminal = (run.body as { status?: string }).status ?? terminal;
          return terminal === "FAILED" || terminal === "SUCCEEDED";
        }
        return false;
      });
      const upstreamSlice = litellm.fakeOpenAI.requests.slice(before);
      const upstreamAttempts = providerModelCounts(upstreamSlice).get(
        "gpt-routing-retry-429",
      );
      expect(upstreamAttempts).toBeGreaterThanOrEqual(1);
      const proxyInternalRetriesObserved =
        (upstreamAttempts ?? 0) > 1
          ? "OBSERVED_MULTIPLE_UPSTREAM_CALLS"
          : "NOT_VERIFIED";
      console.log(
        JSON.stringify({
          scenario: "L10",
          osvaRunTerminalStatus: terminal,
          osvaModelSteps: 1,
          upstreamGptRoutingRetry429Requests: upstreamAttempts ?? 0,
          additionalUpstreamRequestsBeyondFirst: Math.max(
            0,
            (upstreamAttempts ?? 0) - 1,
          ),
          proxyInternalRetryBehavior: proxyInternalRetriesObserved,
          note:
            proxyInternalRetriesObserved === "NOT_VERIFIED"
              ? "This test does not prove LiteLLM suppresses hidden retries; it only records upstream calls under this pinned build and route."
              : "Multiple upstream calls observed for one OSVA gateway invocation; treat as operator risk if OSVA still shows one MODEL step.",
        }),
      );
      const steps = await runs.listRunSteps({
        runAttemptId: runAttemptId as import("@osva-ai/contracts").RunAttemptId,
        limit: 5,
      });
      expect(steps.steps.filter((step) => step.kind === "MODEL")).toHaveLength(
        1,
      );
    } finally {
      await stack.shutdown();
    }
  }, 150_000);
});
