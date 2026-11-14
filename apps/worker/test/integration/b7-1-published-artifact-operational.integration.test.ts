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
  B7_1_FIXTURE_WORKSPACE,
  B7_1_STDIO_WEB_ENV,
  B7_1_STDIO_WORKER_ENV,
  agentIntegrity,
  assertToolRunStep,
  copyAgentFixtures,
  createAndAwaitRun,
  createTrustedTypescriptAgent,
  isPublishedArtifactLaneEnabled,
  loadRunSteps,
  readPublishedStdioEntry,
  seedPublishedNpmMetadataTool,
} from "./b7-1-stdio-runtime-harness.js";

const NOW = new Date("2026-01-20T12:00:00.000Z");
const LANE_ENABLED = isPublishedArtifactLaneEnabled();

describe.skipIf(!LANE_ENABLED)(
  "PUBLISHED_ARTIFACT operational acceptance — @osva-ai/connector-npm@0.1.1",
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
      await bootstrapIntegrationAuth(database, B7_1_FIXTURE_WORKSPACE, NOW);
    });

    it("invokes npm_package_metadata on the published npm connector through the real worker", async () => {
      const stdioEntry = readPublishedStdioEntry();
      const trustedRuntimeRoot = await copyAgentFixtures(
        "mcp-npm-metadata-agent.ts",
      );
      const integrity = await agentIntegrity(
        trustedRuntimeRoot,
        "mcp-npm-metadata-agent.ts",
      );

      const web = createWebProcess(
        withTestAuthEnv({
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_WEB_HOST: "127.0.0.1",
          OSVA_WEB_PORT: "0",
          ...B7_1_STDIO_WEB_ENV,
        }),
      );
      const worker = createWorkerProcess({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        ...B7_1_STDIO_WORKER_ENV,
      });

      try {
        const port = await web.listen();
        await worker.start();
        const origin = `http://127.0.0.1:${String(port)}`;
        const seeded = await seedPublishedNpmMetadataTool({
          origin,
          stdioEntry,
        });
        const agents = await createTrustedTypescriptAgent({
          origin,
          agentKey: "b7-1-published-npm",
          agentName: "B7.1 Published npm",
          entrypoint: "mcp-npm-metadata-agent.ts",
          integrity,
          toolBindings: {
            npm_package_metadata: { toolVersionId: seeded.toolVersionId },
          },
          timeoutMs: 120_000,
        });

        const run = await createAndAwaitRun({
          origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { packageName: "lodash" },
          timeoutMs: 180_000,
        });
        expect(run.terminalStatus).toBe("SUCCEEDED");

        const attempt = await fetchJson(
          `${origin}/v1/runs/${run.runId}/attempts/${run.runAttemptId}`,
        );
        expect(attempt.body).toMatchObject({ status: "SUCCEEDED" });
        const output = (attempt.body as { output?: unknown }).output;
        expect(output).toBeTruthy();
        const metadata = (
          output as { metadata?: { name?: unknown; packageName?: unknown } }
        ).metadata;
        expect(metadata).toBeTruthy();
        expect(metadata).toEqual(
          expect.objectContaining({
            name: expect.any(String),
          }),
        );

        const steps = await loadRunSteps(origin, run.runId, run.runAttemptId);
        assertToolRunStep({
          steps,
          toolVersionId: seeded.toolVersionId,
          bindingName: "npm_package_metadata",
          status: "SUCCEEDED",
        });

        // Operator evidence (stdout)
        console.log(
          JSON.stringify({
            lane: "PUBLISHED_ARTIFACT",
            connectorPackage: "@osva-ai/connector-npm@0.1.1",
            connectorStdioEntry: stdioEntry,
            connectorVersionId: seeded.connectorVersionId,
            toolVersionId: seeded.toolVersionId,
            agentVersionId: agents.agentVersionId,
            runId: run.runId,
            runAttemptId: run.runAttemptId,
            terminalStatus: run.terminalStatus,
          }),
        );
      } finally {
        await worker.stop();
        await web.stop();
      }
    }, 240_000);
  },
);

describe("PUBLISHED_ARTIFACT operational lane gate", () => {
  it("is not enabled unless operator sets OSVA_B7_1_PUBLISHED_ARTIFACT_LANE=1", () => {
    if (LANE_ENABLED) {
      expect(readPublishedStdioEntry().length).toBeGreaterThan(0);
      return;
    }
    expect(process.env.OSVA_B7_1_PUBLISHED_ARTIFACT_LANE).not.toBe("1");
  });
});
