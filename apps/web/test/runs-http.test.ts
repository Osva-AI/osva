import type {
  AgentId,
  ApiKeyId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  COMMUNITY_EDITION_ROLES,
  DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
  PUBLIC_API_ERROR_CODES,
  RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
  RUN_RECOVERY_METADATA_VERSION,
} from "@osva-ai/contracts";
import { RECOVERY_NOT_CHECKPOINTED_CODE } from "@osva/domain";
import { afterEach, describe, expect, it } from "vitest";

import { encodeRunListCursor } from "../src/run-cursor.js";
import { closeHttpServer, listenHttpServer } from "../src/server.js";
import {
  authHeadersForKey,
  clearTestAuthHeaders,
  fetchJson,
  setTestAuthHeaders,
} from "./http-test-helpers.js";
import {
  createTwoWorkspaceHarness,
  expectV1Error,
  expectUnauthorized,
  fetchV1,
} from "./two-workspace-harness.js";
import {
  TEST_NOW,
  createTestWebApplication,
  seedTestApiKey,
} from "./test-web.js";

const WORKSPACE_ID = "ws-1" as WorkspaceId;

const VALID_MANIFEST = {
  schemaVersion: "1",
  key: "example-agent",
  name: "Example Agent",
  runtime: {
    type: "BUILTIN_PACKAGE",
    key: "example-agent",
  },
  input: { schema: {} },
  output: { schema: {} },
  execution: { timeoutMs: 30_000, maxAttempts: 2 },
  capabilities: { model: false, tools: [] },
};

type TestWebContext = Awaited<ReturnType<typeof createTestWebApplication>>;

async function seedInterruptedRunWithLatestCheckpoint(
  origin: string,
  ctx: TestWebContext,
): Promise<{
  runId: RunId;
  firstRunAttemptId: RunAttemptId;
  agentVersionId: string;
}> {
  const registered = await registerAgent(origin);
  const created = await createRun(origin, registered, { prompt: "recovery-s" });
  const runId = created.run.id as RunId;
  const firstRunAttemptId = created.runAttempt.id as RunAttemptId;

  const loadedRun = await ctx.runs.findRunById(runId);
  const loadedAttempt = await ctx.runs.findRunAttemptById(firstRunAttemptId);
  if (loadedRun === null || loadedAttempt === null) {
    throw new Error("expected run + attempt after createRun");
  }

  let run = loadedRun.transitionTo("RUNNING", TEST_NOW);
  let attempt = loadedAttempt.transitionTo("RUNNING", TEST_NOW);
  ctx.runs.replaceRun(run);
  ctx.runs.replaceRunAttempt(attempt);

  run = run.transitionTo("INTERRUPTED", TEST_NOW);
  attempt = attempt.transitionTo("FAILED", TEST_NOW, {
    error: { code: "EXECUTION_INTERRUPTED", message: "test interrupt" },
  });
  ctx.runs.replaceRun(run);
  ctx.runs.replaceRunAttempt(attempt);

  const bindings = run.effectiveBindings;
  ctx.runCheckpoints.trackRunningAttempt({
    runAttemptId: firstRunAttemptId,
    owner: "test-worker",
    generation: 1,
  });
  const committed = await ctx.runCheckpoints.commit({
    workspaceId: ctx.workspaceId,
    runId,
    runAttemptId: firstRunAttemptId,
    executionGeneration: 1,
    executionOwner: "test-worker",
    runtimeKind: "DECLARATIVE",
    bindingIdentity: {
      agentVersionId: bindings.agentVersionId,
      modelProfileVersionBindings: { ...bindings.modelProfileVersionBindings },
      toolVersionBindings: { ...bindings.toolVersionBindings },
    },
    cursor: { phase: "after_model", checkpointSequence: 1 },
    state: {
      schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
      messages: [],
      modelInvocations: 1,
      toolInvocations: 0,
    },
    idempotencyKey: `test-cp-${runId}`,
  });
  if (committed.outcome !== "committed") {
    throw new Error(`expected checkpoint commit, got ${committed.outcome}`);
  }

  return {
    runId,
    firstRunAttemptId,
    agentVersionId: registered.agentVersionId,
  };
}

describe("Run HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("creates a Run through the HTTP API using a registered AgentVersion", async () => {
    const { origin, queue } = await listen();
    const registered = await registerAgent(origin);

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId: registered.agentId,
        agentVersionId: registered.agentVersionId,
        input: { prompt: "hello" },
      },
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      run: {
        id: "id-3",
        agentId: registered.agentId,
        status: "QUEUED",
        effectiveBindings: {
          agentVersionId: registered.agentVersionId,
          modelProfileVersionBindings: {},
          toolVersionBindings: {},
        },
        input: { prompt: "hello" },
        createdAt: TEST_NOW.toISOString(),
      },
      runAttempt: {
        id: "id-4",
        runId: "id-3",
        sequence: 1,
        status: "PENDING",
      },
    });
    expect(queue.pendingRunAttemptIds()).toEqual(["id-4"]);

    const loaded = await fetchJson(`${origin}/v1/runs/id-3`);
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual((created.body as { run: unknown }).run);
  });

  it("rejects VIEWER creating a Run", async () => {
    const { origin, apiKeys } = await listen();
    const registered = await registerAgent(origin);
    const viewer = await seedTestApiKey({
      apiKeys,
      workspaceId: WORKSPACE_ID,
      role: COMMUNITY_EDITION_ROLES.VIEWER,
      apiKeyId: "ak-viewer-run" as ApiKeyId,
    });

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      headers: authHeadersForKey(viewer),
      body: {
        agentId: registered.agentId,
        agentVersionId: registered.agentVersionId,
        input: { prompt: "hello" },
      },
    });

    expect(created.status).toBe(403);
    expect(created.body).toMatchObject({
      status: "error",
      code: "PERMISSION_DENIED",
    });
  });

  it("rejects a client-authored effectiveBindings object", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId: registered.agentId,
        agentVersionId: registered.agentVersionId,
        effectiveBindings: {
          agentVersionId: registered.agentVersionId,
          modelProfileVersionBindings: {
            default: "model-profile-version-1",
          },
        },
        input: { prompt: "hello" },
      },
    });

    expect(created.status).toBe(400);
    expect(created.body).toEqual({ status: "invalid_request" });
  });

  it("rejects CreateRun when the AgentVersion belongs to another Agent", async () => {
    const { origin, queue } = await listen();
    await registerAgent(origin, { key: "first-agent" });
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "second-agent",
        name: "Second Agent",
      },
    });
    await fetchJson(`${origin}/v1/agents/id-3/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId: "id-1",
        agentVersionId: "id-4",
        input: { prompt: "hello" },
      },
    });

    expect(created.status).toBe(400);
    expect(created.body).toEqual({ status: "invalid_request" });
    expect(queue.pendingRunAttemptIds()).toEqual([]);
    expect((await fetchJson(`${origin}/v1/runs/id-5`)).status).toBe(404);
  });

  it("returns not_found for a missing Run", async () => {
    const { origin } = await listen();
    const response = await fetchJson(`${origin}/v1/runs/missing`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      status: "error",
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("lists Runs with deterministic ordering and cursor pagination", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);

    const first = await createRun(origin, registered, { prompt: "a" });
    const second = await createRun(origin, registered, { prompt: "b" });
    const third = await createRun(origin, registered, { prompt: "c" });

    const page1 = await fetchJson(`${origin}/v1/runs?limit=2`);
    expect(page1.status).toBe(200);
    const page1Body = page1.body as {
      runs: Array<{ id: string; input: { prompt: string } }>;
      nextCursor: string;
    };
    expect(page1Body.runs.map((run) => run.id)).toEqual([
      third.run.id,
      second.run.id,
    ]);
    expect(page1Body.nextCursor).toEqual(expect.any(String));

    const page2 = await fetchJson(
      `${origin}/v1/runs?limit=2&cursor=${encodeURIComponent(page1Body.nextCursor)}`,
    );
    expect(page2.status).toBe(200);
    const page2Body = page2.body as {
      runs: Array<{ id: string }>;
      nextCursor?: string;
    };
    expect(page2Body.runs.map((run) => run.id)).toEqual([first.run.id]);
    expect(page2Body.nextCursor).toBeUndefined();
  });

  it("tie-breaks Run list pages by id when createdAt matches", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    await createRun(origin, registered, { n: 1 });
    await createRun(origin, registered, { n: 2 });
    await createRun(origin, registered, { n: 3 });

    const listed = await fetchJson(`${origin}/v1/runs?limit=2`);
    const body = listed.body as {
      runs: Array<{ id: string }>;
      nextCursor: string;
    };
    expect(body.runs.map((run) => run.id)).toEqual(["id-7", "id-5"]);

    const next = await fetchJson(
      `${origin}/v1/runs?limit=2&cursor=${encodeURIComponent(body.nextCursor)}`,
    );
    expect(
      (next.body as { runs: Array<{ id: string }> }).runs.map((run) => run.id),
    ).toEqual(["id-3"]);
  });

  it("filters Runs by agentId, agentVersionId, and status", async () => {
    const { origin } = await listen();
    const first = await registerAgent(origin, { key: "one" });
    await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: "two",
        name: "Second Agent",
      },
    });
    const secondVersion = await fetchJson(`${origin}/v1/agents/id-3/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });
    const second = {
      agentId: "id-3" as AgentId,
      agentVersionId: (secondVersion.body as { id: string }).id,
    };

    await createRun(origin, first, { from: "one" });
    await createRun(origin, second, { from: "two" });

    const byAgent = await fetchJson(
      `${origin}/v1/runs?agentId=${first.agentId}`,
    );
    expect(
      (byAgent.body as { runs: Array<{ agentId: string }> }).runs.every(
        (run) => run.agentId === first.agentId,
      ),
    ).toBe(true);
    expect((byAgent.body as { runs: unknown[] }).runs).toHaveLength(1);

    const byVersion = await fetchJson(
      `${origin}/v1/runs?agentVersionId=${second.agentVersionId}`,
    );
    expect(
      (
        byVersion.body as {
          runs: Array<{ effectiveBindings: { agentVersionId: string } }>;
        }
      ).runs.map((run) => run.effectiveBindings.agentVersionId),
    ).toEqual([second.agentVersionId]);

    const byStatus = await fetchJson(`${origin}/v1/runs?status=QUEUED`);
    expect(
      (byStatus.body as { runs: Array<{ status: string }> }).runs.every(
        (run) => run.status === "QUEUED",
      ),
    ).toBe(true);
  });

  it("rejects invalid Run list limits and cursors", async () => {
    const { origin } = await listen();
    expect((await fetchJson(`${origin}/v1/runs?limit=0`)).status).toBe(400);
    expect((await fetchJson(`${origin}/v1/runs?limit=101`)).status).toBe(400);
    expect((await fetchJson(`${origin}/v1/runs?limit=abc`)).status).toBe(400);
    expect(
      (await fetchJson(`${origin}/v1/runs?cursor=not-a-cursor`)).status,
    ).toBe(400);
    expect(
      (await fetchJson(`${origin}/v1/runs?status=NOT_A_STATUS`)).status,
    ).toBe(400);
    expect(
      (
        await fetchJson(
          `${origin}/v1/runs?cursor=${encodeURIComponent(encodeRunListCursor({ createdAt: "nope", id: "run-1" }))}`,
        )
      ).status,
    ).toBe(400);
  });

  it("lists and loads RunAttempts nested under the owning Run", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered, { prompt: "nested" });

    const listed = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/attempts`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      attempts: [created.runAttempt],
    });

    const loaded = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/attempts/${created.runAttempt.id}`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body).toEqual(created.runAttempt);
  });

  it("does not leak a RunAttempt through another Run nested route", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    const first = await createRun(origin, registered, { n: 1 });
    const second = await createRun(origin, registered, { n: 2 });

    const leaked = await fetchJson(
      `${origin}/v1/runs/${first.run.id}/attempts/${second.runAttempt.id}`,
    );
    expect(leaked.status).toBe(404);
    expect(leaked.body).toMatchObject({
      status: "error",
      code: "RESOURCE_NOT_FOUND",
    });

    const missingRun = await fetchJson(`${origin}/v1/runs/missing/attempts`);
    expect(missingRun.status).toBe(404);
  });

  it("exposes run recovery read endpoints and idempotent resume for queued runs", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered, {
      prompt: "recovery-read",
    });

    const recovery = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/recovery`,
    );
    expect(recovery.status).toBe(200);
    expect(recovery.body).toMatchObject({
      runId: created.run.id,
      runStatus: "QUEUED",
      eligible: false,
    });

    const checkpoints = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/checkpoints`,
    );
    expect(checkpoints.status).toBe(200);
    expect(checkpoints.body).toMatchObject({
      runId: created.run.id,
      checkpoints: [],
    });

    const resume = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/resume`,
      { method: "POST", body: {} },
    );
    expect([200, 202]).toContain(resume.status);
    expect(resume.body).toMatchObject({
      runId: created.run.id,
      runAttemptId: created.runAttempt.id,
      outcome: "already_scheduled",
    });
  });

  it("rejects VIEWER resume on Run recovery", async () => {
    const { origin, apiKeys } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered, { prompt: "viewer" });

    const viewer = await seedTestApiKey({
      apiKeys,
      workspaceId: WORKSPACE_ID,
      role: COMMUNITY_EDITION_ROLES.VIEWER,
      apiKeyId: "ak-viewer-resume" as ApiKeyId,
    });

    const denied = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/resume`,
      {
        method: "POST",
        body: {},
        headers: authHeadersForKey(viewer),
      },
    );
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({
      status: "error",
      code: "PERMISSION_DENIED",
    });
  });

  it("requires authentication for run recovery routes", async () => {
    const ctx = await createTestWebApplication({ workspaceId: WORKSPACE_ID });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const operatorAuth = authHeadersForKey(ctx.testApiKey);
    setTestAuthHeaders(ctx.testApiKey);
    clearTestAuthHeaders();

    try {
      const registered = await registerAgent(origin, {
        headers: operatorAuth,
      });
      const created = await createRun(
        origin,
        registered,
        {
          prompt: "recovery-auth",
        },
        operatorAuth,
      );

      const recovery = await fetchV1(
        `${origin}/v1/runs/${created.run.id}/recovery`,
      );
      expectUnauthorized(recovery);

      const checkpoints = await fetchV1(
        `${origin}/v1/runs/${created.run.id}/checkpoints`,
      );
      expectUnauthorized(checkpoints);

      const resume = await fetchV1(
        `${origin}/v1/runs/${created.run.id}/resume`,
        { method: "POST", body: {} },
      );
      expectUnauthorized(resume);
    } finally {
      setTestAuthHeaders(ctx.testApiKey);
    }
  });

  it("scopes recovery and checkpoint routes to the principal workspace", async () => {
    const harness = await createTwoWorkspaceHarness(servers);

    const registered = await registerAgent(harness.origin, {
      headers: harness.authA,
    });
    const created = await fetchV1(`${harness.origin}/v1/runs`, {
      method: "POST",
      headers: harness.authA,
      body: {
        agentId: registered.agentId,
        agentVersionId: registered.agentVersionId,
        input: { prompt: "iso" },
      },
    });
    expect(created.status).toBe(201);
    const runId = (created.body as { run: { id: string } }).run.id;

    expectV1Error(
      await fetchV1(`${harness.origin}/v1/runs/${runId}/recovery`, {
        headers: harness.authB,
      }),
      404,
      PUBLIC_API_ERROR_CODES.RESOURCE_NOT_FOUND,
    );
    expectV1Error(
      await fetchV1(`${harness.origin}/v1/runs/${runId}/checkpoints`, {
        headers: harness.authB,
      }),
      404,
      PUBLIC_API_ERROR_CODES.RESOURCE_NOT_FOUND,
    );
    const resumeB = await fetchV1(`${harness.origin}/v1/runs/${runId}/resume`, {
      method: "POST",
      headers: harness.authB,
      body: {},
    });
    expect(resumeB.status).toBe(404);
    expect(resumeB.body).toMatchObject({
      code: "RUN_NOT_FOUND",
      message: "Run was not found.",
    });
  });

  it("allows OPERATOR resume for an interrupted run with a checkpoint", async () => {
    const { origin, ctx } = await listen();
    const { runId, firstRunAttemptId } =
      await seedInterruptedRunWithLatestCheckpoint(origin, ctx);

    const recoveryBefore = await fetchJson(
      `${origin}/v1/runs/${runId}/recovery`,
    );
    expect(recoveryBefore.status).toBe(200);
    expect(recoveryBefore.body).toMatchObject({
      runId,
      runStatus: "INTERRUPTED",
      eligible: true,
    });

    const checkpoints = await fetchJson(
      `${origin}/v1/runs/${runId}/checkpoints`,
    );
    expect(checkpoints.status).toBe(200);
    const cpBody = checkpoints.body as {
      checkpoints: ReadonlyArray<Record<string, unknown>>;
    };
    expect(cpBody.checkpoints.length).toBe(1);
    expect(cpBody.checkpoints[0]).not.toHaveProperty("state");
    expect(cpBody.checkpoints[0]).not.toHaveProperty("bindingDigest");
    expect(cpBody.checkpoints[0]).not.toHaveProperty("payloadDigest");

    const resume = await fetchJson(`${origin}/v1/runs/${runId}/resume`, {
      method: "POST",
      body: {},
    });
    expect(resume.status).toBe(202);
    expect(resume.body).toMatchObject({
      runId,
      outcome: "scheduled",
    });
    const nextAttemptId = (resume.body as { runAttemptId: string })
      .runAttemptId;
    expect(nextAttemptId).not.toBe(firstRunAttemptId);

    const recoveryAfter = await fetchJson(
      `${origin}/v1/runs/${runId}/recovery`,
    );
    expect(recoveryAfter.status).toBe(200);
    expect(recoveryAfter.body).toMatchObject({
      runId,
      runStatus: "QUEUED",
      eligible: false,
    });
  });

  it("is idempotent when resuming a run that is already queued for recovery", async () => {
    const { origin, ctx } = await listen();
    const { runId } = await seedInterruptedRunWithLatestCheckpoint(origin, ctx);

    const first = await fetchJson(`${origin}/v1/runs/${runId}/resume`, {
      method: "POST",
      body: { idempotencyKey: "resume-dup" },
    });
    expect(first.status).toBe(202);
    const runAttemptId = (first.body as { runAttemptId: string }).runAttemptId;

    const second = await fetchJson(`${origin}/v1/runs/${runId}/resume`, {
      method: "POST",
      body: { idempotencyKey: "resume-dup" },
    });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      runId,
      runAttemptId,
      outcome: "already_scheduled",
    });
  });

  it("rejects resume when the run has already succeeded", async () => {
    const { origin, ctx } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered, {
      prompt: "terminal-resume",
    });
    const runId = created.run.id as RunId;
    const runAttemptId = created.runAttempt.id as RunAttemptId;

    const loadedRun = await ctx.runs.findRunById(runId);
    const loadedAttempt = await ctx.runs.findRunAttemptById(runAttemptId);
    if (loadedRun === null || loadedAttempt === null) {
      throw new Error("expected run");
    }
    let run = loadedRun.transitionTo("RUNNING", TEST_NOW);
    let attempt = loadedAttempt.transitionTo("RUNNING", TEST_NOW);
    ctx.runs.replaceRun(run);
    ctx.runs.replaceRunAttempt(attempt);
    run = run.transitionTo("SUCCEEDED", TEST_NOW);
    attempt = attempt.transitionTo("SUCCEEDED", TEST_NOW, {
      output: { ok: true },
    });
    ctx.runs.replaceRun(run);
    ctx.runs.replaceRunAttempt(attempt);

    const succeeded = await fetchJson(`${origin}/v1/runs/${runId}/resume`, {
      method: "POST",
      body: {},
    });
    expect(succeeded.status).toBe(409);
    expect(succeeded.body).toMatchObject({
      code: "RUN_NOT_INTERRUPTED",
    });
  });

  it("rejects resume when interrupted but no checkpoint exists", async () => {
    const { origin, ctx } = await listen();
    const other = await registerAgent(origin, { key: "other-agent" });
    const otherCreated = await createRun(origin, other, {
      prompt: "no-checkpoint",
    });
    const otherRunId = otherCreated.run.id as RunId;

    const loaded = await ctx.runs.findRunById(otherRunId);
    const loadedAttempt = await ctx.runs.findRunAttemptById(
      otherCreated.runAttempt.id as RunAttemptId,
    );
    if (loaded === null || loadedAttempt === null) {
      throw new Error("expected run");
    }
    let run = loaded.transitionTo("RUNNING", TEST_NOW);
    let attempt = loadedAttempt.transitionTo("RUNNING", TEST_NOW);
    ctx.runs.replaceRun(run);
    ctx.runs.replaceRunAttempt(attempt);
    run = run.transitionTo("INTERRUPTED", TEST_NOW);
    attempt = attempt.transitionTo("FAILED", TEST_NOW, {
      error: { code: "EXECUTION_INTERRUPTED", message: "no cp" },
    });
    ctx.runs.replaceRun(run);
    ctx.runs.replaceRunAttempt(attempt);

    const noCp = await fetchJson(`${origin}/v1/runs/${otherRunId}/resume`, {
      method: "POST",
      body: {},
    });
    expect(noCp.status).toBe(409);
    expect(noCp.body).toMatchObject({
      code: RECOVERY_NOT_CHECKPOINTED_CODE,
    });
  });

  it("rejects resume when automatic recovery is blocked by uncertain external writes", async () => {
    const { origin, ctx } = await listen();
    const { runId, firstRunAttemptId } =
      await seedInterruptedRunWithLatestCheckpoint(origin, ctx);

    await ctx.runOperationJournal.recordPending({
      workspaceId: ctx.workspaceId,
      runId,
      runAttemptId: firstRunAttemptId,
      executionGeneration: 1,
      operationKey: "tool:ext",
      toolVersionId: "tv-ext" as import("@osva-ai/contracts").ToolVersionId,
      bindingName: "external",
      inputFingerprint: "fp-1",
      idempotencyClass: "UNKNOWN_WRITE",
    });
    await ctx.runOperationJournal.markUncertain({
      workspaceId: ctx.workspaceId,
      runId,
      operationKey: "tool:ext",
    });

    const recovery = await fetchJson(`${origin}/v1/runs/${runId}/recovery`);
    expect(recovery.status).toBe(200);
    expect(recovery.body).toMatchObject({
      eligible: false,
      ineligibleCode: RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
    });

    const blocked = await fetchJson(`${origin}/v1/runs/${runId}/resume`, {
      method: "POST",
      body: {},
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({
      code: RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
    });
  });

  it("rejects resume when recovery metadata records an operator block", async () => {
    const { origin, ctx } = await listen();
    const { runId } = await seedInterruptedRunWithLatestCheckpoint(origin, ctx);

    const run = await ctx.runs.findRunById(runId);
    if (run === null) {
      throw new Error("expected run");
    }
    ctx.runs.replaceRun(
      run.withRecoveryMetadata(
        {
          version: RUN_RECOVERY_METADATA_VERSION,
          recoveryAttemptCount: 0,
          automaticRecoveryEnabled: false,
          blocked: {
            code: "OPERATOR_RECOVERY_BLOCK",
            message: "Blocked by operator.",
            at: TEST_NOW.toISOString(),
          },
        },
        TEST_NOW,
      ),
    );

    const resume = await fetchJson(`${origin}/v1/runs/${runId}/resume`, {
      method: "POST",
      body: {},
    });
    expect(resume.status).toBe(409);
    expect(resume.body).toMatchObject({
      code: "OPERATOR_RECOVERY_BLOCK",
    });
  });

  it("rejects invalid checkpoint list limit query", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered, { prompt: "limit" });

    const badLimit = await fetchJson(
      `${origin}/v1/runs/${created.run.id}/checkpoints?limit=0`,
    );
    expect(badLimit.status).toBe(400);
    expect(badLimit.body).toEqual({ status: "invalid_request" });
  });

  it("does not expose Run mutation endpoints", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);
    const created = await createRun(origin, registered, {
      prompt: "immutable",
    });

    expect(
      (
        await fetchJson(`${origin}/v1/runs/${created.run.id}`, {
          method: "PATCH",
          body: { status: "CANCELLED" },
        })
      ).status,
    ).toBe(405);
    expect(
      (
        await fetchJson(`${origin}/v1/runs/${created.run.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(405);
    expect(
      (
        await fetchJson(`${origin}/v1/runs/${created.run.id}/attempts`, {
          method: "POST",
          body: {},
        })
      ).status,
    ).toBe(405);
  });

  it("rejects client-controlled Run identity fields", async () => {
    const { origin } = await listen();
    const registered = await registerAgent(origin);

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        id: "chosen-run",
        runAttemptId: "chosen-attempt",
        status: "SUCCEEDED",
        agentId: registered.agentId,
        agentVersionId: registered.agentVersionId,
        input: { prompt: "hello" },
      },
    });
    expect(created.status).toBe(400);
    expect(created.body).toEqual({ status: "invalid_request" });
  });

  async function listen() {
    const ctx = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    setTestAuthHeaders(ctx.testApiKey);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      queue: ctx.queue,
      apiKeys: ctx.apiKeys,
      ctx,
    };
  }
});

async function registerAgent(
  origin: string,
  options?: {
    readonly key?: string;
    readonly headers?: Record<string, string>;
  },
): Promise<{ agentId: string; agentVersionId: string }> {
  const created = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      key: options?.key ?? "example-agent",
      name: "Example Agent",
    },
    headers: options?.headers,
  });
  expect(created.status).toBe(201);
  const agentId = (created.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: { manifest: VALID_MANIFEST },
    headers: options?.headers,
  });
  expect(version.status).toBe(201);
  return {
    agentId,
    agentVersionId: (version.body as { id: string }).id,
  };
}

async function createRun(
  origin: string,
  registered: { readonly agentId: string; readonly agentVersionId: string },
  input: unknown,
  headers?: Record<string, string>,
): Promise<{
  run: { id: string };
  runAttempt: { id: string };
}> {
  const created = await fetchJson(`${origin}/v1/runs`, {
    method: "POST",
    body: {
      agentId: registered.agentId,
      agentVersionId: registered.agentVersionId,
      input,
    },
    headers,
  });
  expect(created.status).toBe(201);
  return created.body as {
    run: { id: string };
    runAttempt: { id: string };
  };
}
