import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";

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
  copyAgentFixtures,
  createAndAwaitRun,
  createTrustedTypescriptAgent,
  loadRunSteps,
} from "./b7-1-stdio-runtime-harness.js";
import {
  GITHUB_LIVE_SECRET_REF_KEY,
  GITHUB_REPOSITORY_GET_BINDING,
  assertNoSecretLeakInJson,
  buildGithubLiveTransportConfig,
  isGithubPublishedArtifactLaneEnabled,
  readGithubPublishedStdioEntry,
  seedGithubRepositoryGetTool,
} from "./b7-2-github-operational.harness.js";

const WORKSPACE_ID =
  "ws-b7-2-github-live" as import("@osva-ai/contracts").WorkspaceId;
const NOW = new Date("2026-02-01T12:00:00.000Z");
const LANE_ENABLED = isGithubPublishedArtifactLaneEnabled();

function operatorPatForLeakCheck(): string | undefined {
  const value = process.env[GITHUB_LIVE_SECRET_REF_KEY]?.trim();
  return value && value.length > 0 ? value : undefined;
}

describe.skipIf(!LANE_ENABLED)(
  "PUBLISHED_ARTIFACT_LIVE_ACCEPTANCE — @osva-ai/connector-github@0.4.0 read-only",
  () => {
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
    });

    it("invokes github.repository.get against live GitHub (read-only)", async () => {
      const stdioEntry = readGithubPublishedStdioEntry();
      const operatorPat = operatorPatForLeakCheck();
      if (operatorPat === undefined) {
        throw new Error("Operator PAT is not configured.");
      }
      const trustedRuntimeRoot = await copyAgentFixtures(
        "mcp-github-repository-get-agent.ts",
      );
      const integrity = await agentIntegrity(
        trustedRuntimeRoot,
        "mcp-github-repository-get-agent.ts",
      );
      const shared = {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
        [GITHUB_LIVE_SECRET_REF_KEY]: operatorPat,
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

      try {
        const port = await web.listen();
        await worker.start();
        const origin = `http://127.0.0.1:${String(port)}`;
        const seeded = await seedGithubRepositoryGetTool({
          origin,
          transportConfig: buildGithubLiveTransportConfig(stdioEntry),
          connectorKey: "b7-2-published-github",
        });
        const connectorVersion = await fetchJson(
          `${origin}/v1/connectors/${seeded.connectorId}/versions/${seeded.connectorVersionId}`,
        );
        assertNoSecretLeakInJson(
          JSON.stringify(connectorVersion.body),
          operatorPat,
        );
        expect(JSON.stringify(connectorVersion.body)).toContain(
          GITHUB_LIVE_SECRET_REF_KEY,
        );
        expect(JSON.stringify(connectorVersion.body)).not.toContain(
          operatorPat,
        );

        const agents = await createTrustedTypescriptAgent({
          origin,
          agentKey: "b7-2-live-github",
          agentName: "B7.2 Live GitHub",
          entrypoint: "mcp-github-repository-get-agent.ts",
          integrity,
          toolBindings: {
            [GITHUB_REPOSITORY_GET_BINDING]: {
              toolVersionId: seeded.toolVersionId,
            },
          },
          timeoutMs: 120_000,
        });

        const run = await createAndAwaitRun({
          origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { owner: "Osva-AI", repo: "osva" },
          timeoutMs: 180_000,
        });
        expect(run.terminalStatus).toBe("SUCCEEDED");

        const attempt = await fetchJson(
          `${origin}/v1/runs/${run.runId}/attempts/${run.runAttemptId}`,
        );
        const output = (attempt.body as { output?: Record<string, unknown> })
          .output;
        expect(output).toBeTruthy();
        expect(output).toEqual(
          expect.objectContaining({
            name: expect.any(String),
            fullName: expect.stringMatching(/osva/i),
          }),
        );

        const steps = await loadRunSteps(origin, run.runId, run.runAttemptId);
        const toolStep = assertToolRunStep({
          steps,
          toolVersionId: seeded.toolVersionId,
          bindingName: GITHUB_REPOSITORY_GET_BINDING,
          status: "SUCCEEDED",
        });
        assertNoSecretLeakInJson(JSON.stringify(attempt.body), operatorPat);
        assertNoSecretLeakInJson(JSON.stringify(steps), operatorPat);
        assertNoSecretLeakInJson(JSON.stringify(toolStep), operatorPat);

        console.log(
          JSON.stringify({
            lane: "PUBLISHED_ARTIFACT_LIVE_ACCEPTANCE",
            connectorPackage: "@osva-ai/connector-github@0.4.0",
            connectorStdioEntry: stdioEntry,
            connectorVersionId: seeded.connectorVersionId,
            toolVersionId: seeded.toolVersionId,
            agentVersionId: agents.agentVersionId,
            runId: run.runId,
            runAttemptId: run.runAttemptId,
            runStepId: toolStep.id,
            bindingName: GITHUB_REPOSITORY_GET_BINDING,
            terminalStatus: run.terminalStatus,
          }),
        );
      } finally {
        await worker.stop();
        await web.stop();
      }
    }, 300_000);
  },
);

describe("PUBLISHED_ARTIFACT_LIVE_ACCEPTANCE gate", () => {
  it("requires operator lane flag, stdio entry, and B7_2_GITHUB_OPERATOR_PAT", () => {
    if (LANE_ENABLED) {
      expect(readGithubPublishedStdioEntry().length).toBeGreaterThan(0);
      expect(livePatEnvPresent()).toBe(true);
      return;
    }
    expect(process.env.OSVA_B7_2_PUBLISHED_ARTIFACT_LANE).not.toBe("1");
  });
});

function livePatEnvPresent(): boolean {
  const value = process.env[GITHUB_LIVE_SECRET_REF_KEY]?.trim() ?? "";
  return value.length > 0;
}
