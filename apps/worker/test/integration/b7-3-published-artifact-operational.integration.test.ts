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
  GA4_LIVE_CREDENTIALS_PATH_REF_KEY,
  GA4_LIVE_PROPERTY_SECRET_REF_KEY,
  GA4_PROPERTY_GET_BINDING,
  SHOPIFY_LIVE_SECRET_REF_KEY,
  SHOPIFY_LIVE_SHOP_SECRET_REF_KEY,
  SHOPIFY_SHOP_GET_BINDING,
  assertNoCommerceSecretLeakInJson,
  buildGa4LiveTransportConfig,
  buildShopifyLiveTransportConfig,
  isB7_3PublishedArtifactLaneEnabled,
  readPublishedGa4StdioEntry,
  readPublishedShopifyStdioEntry,
  seedGa4PropertyGetTool,
  seedShopifyShopGetTool,
} from "./b7-3-commerce-analytics-operational.harness.js";

const WORKSPACE_ID =
  "ws-b7-3-commerce-live" as import("@osva-ai/contracts").WorkspaceId;
const NOW = new Date("2026-02-01T12:00:00.000Z");
const LANE_ENABLED = isB7_3PublishedArtifactLaneEnabled();

function operatorSecretsForLeakCheck(): readonly string[] {
  const values = [
    process.env[SHOPIFY_LIVE_SECRET_REF_KEY]?.trim(),
    process.env[GA4_LIVE_CREDENTIALS_PATH_REF_KEY]?.trim(),
  ].filter((v): v is string => v !== undefined && v.length > 0);
  return values;
}

describe.skipIf(!LANE_ENABLED)(
  "PUBLISHED_ARTIFACT_LIVE_ACCEPTANCE — Shopify + GA4 read-only dual connector",
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

    it("invokes shopify.shop.get and ga4.property.get via published npm stdio entries", async () => {
      const shopifyStdio = readPublishedShopifyStdioEntry();
      const ga4Stdio = readPublishedGa4StdioEntry();
      const shopifyToken =
        process.env[SHOPIFY_LIVE_SECRET_REF_KEY]?.trim() ?? "";
      const shopifyShop =
        process.env[SHOPIFY_LIVE_SHOP_SECRET_REF_KEY]?.trim() ?? "";
      const ga4CredentialsPath =
        process.env[GA4_LIVE_CREDENTIALS_PATH_REF_KEY]?.trim() ?? "";
      const ga4PropertyId =
        process.env[GA4_LIVE_PROPERTY_SECRET_REF_KEY]?.trim() ?? "";

      const trustedRuntimeRoot = await copyAgentFixtures(
        "mcp-commerce-dual-read-agent.ts",
      );
      const integrity = await agentIntegrity(
        trustedRuntimeRoot,
        "mcp-commerce-dual-read-agent.ts",
      );
      const shared = {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
        [SHOPIFY_LIVE_SECRET_REF_KEY]: shopifyToken,
        [SHOPIFY_LIVE_SHOP_SECRET_REF_KEY]: shopifyShop,
        [GA4_LIVE_CREDENTIALS_PATH_REF_KEY]: ga4CredentialsPath,
        [GA4_LIVE_PROPERTY_SECRET_REF_KEY]: ga4PropertyId,
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

        const shopify = await seedShopifyShopGetTool({
          origin,
          transportConfig: buildShopifyLiveTransportConfig(shopifyStdio),
          connectorKey: "b7-3-published-shopify",
        });
        const ga4 = await seedGa4PropertyGetTool({
          origin,
          transportConfig: buildGa4LiveTransportConfig(ga4Stdio),
          connectorKey: "b7-3-published-ga4",
        });

        const agents = await createTrustedTypescriptAgent({
          origin,
          agentKey: "b7-3-live-commerce-dual",
          agentName: "B7.3 Live Commerce Dual Read",
          entrypoint: "mcp-commerce-dual-read-agent.ts",
          integrity,
          toolBindings: {
            [SHOPIFY_SHOP_GET_BINDING]: {
              toolVersionId: shopify.toolVersionId,
            },
            [GA4_PROPERTY_GET_BINDING]: {
              toolVersionId: ga4.toolVersionId,
            },
          },
          timeoutMs: 180_000,
        });

        const run = await createAndAwaitRun({
          origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { propertyId: ga4PropertyId },
          timeoutMs: 300_000,
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
            shop: expect.any(Object),
            property: expect.any(Object),
            attributionNote: expect.any(String),
          }),
        );

        const steps = await loadRunSteps(origin, run.runId, run.runAttemptId);
        assertToolRunStep({
          steps,
          toolVersionId: shopify.toolVersionId,
          bindingName: SHOPIFY_SHOP_GET_BINDING,
          status: "SUCCEEDED",
        });
        assertToolRunStep({
          steps,
          toolVersionId: ga4.toolVersionId,
          bindingName: GA4_PROPERTY_GET_BINDING,
          status: "SUCCEEDED",
        });

        const leakSecrets = operatorSecretsForLeakCheck();
        assertNoCommerceSecretLeakInJson(
          JSON.stringify(attempt.body),
          leakSecrets,
        );
        assertNoCommerceSecretLeakInJson(JSON.stringify(steps), leakSecrets);

        console.log(
          JSON.stringify({
            lane: "PUBLISHED_ARTIFACT_LIVE_ACCEPTANCE",
            connectorPackages: [
              "@osva-ai/connector-shopify@0.1.1",
              "@osva-ai/connector-ga4@0.1.1",
            ],
            runId: run.runId,
            runAttemptId: run.runAttemptId,
            toolStepCount: steps.filter((step) => step.kind === "TOOL").length,
          }),
        );
      } finally {
        await worker.stop();
        await web.stop();
      }
    }, 360_000);
  },
);
