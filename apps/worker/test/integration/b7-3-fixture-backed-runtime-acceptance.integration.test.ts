import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";

import {
  FAKE_GA4_ACCESS_TOKEN,
  startMockGa4HttpServer,
  type MockGa4HttpServer,
} from "../../../../packages/tool-gateway/test/fixtures/mock-ga4-http-server.js";
import {
  FAKE_SHOPIFY_ACCESS_TOKEN,
  startMockShopifyHttpServer,
  type MockShopifyHttpServer,
} from "../../../../packages/tool-gateway/test/fixtures/mock-shopify-http-server.js";
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
  FIXTURE_GA4_PROPERTY_ID,
  GA4_PROPERTY_GET_BINDING,
  SHOPIFY_SHOP_GET_BINDING,
  assertFixtureCombinedOutput,
  assertNoCommerceSecretLeakInJson,
  buildGa4FixtureTransportConfig,
  buildShopifyFixtureTransportConfig,
  fixtureShopifyTokenEnv,
  isB7_3FixtureStdioAvailable,
  resolveGa4FixtureStdioEntry,
  resolveShopifyFixtureStdioEntry,
  seedGa4PropertyGetTool,
  seedShopifyShopGetTool,
} from "./b7-3-commerce-analytics-operational.harness.js";

const WORKSPACE_ID =
  "ws-b7-3-commerce-fixture" as import("@osva-ai/contracts").WorkspaceId;
const NOW = new Date("2026-02-01T12:00:00.000Z");
const FIXTURE_READY = isB7_3FixtureStdioAvailable();

describe.skipIf(!FIXTURE_READY)(
  "FIXTURE_BACKED_RUNTIME_ACCEPTANCE — Shopify + GA4 dual MCP STDIO via real worker",
  () => {
    let postgres: PostgresTestContext;
    let valkey: ValkeyTestContext;
    let database: Database;
    let mockShopify: MockShopifyHttpServer;
    let mockGa4: MockGa4HttpServer;

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
      mockShopify = await startMockShopifyHttpServer({
        expectedToken: FAKE_SHOPIFY_ACCESS_TOKEN,
      });
      mockGa4 = await startMockGa4HttpServer({
        expectedToken: FAKE_GA4_ACCESS_TOKEN,
      });
    });

    async function startStack(options: {
      readonly shopifyToken?: string;
      readonly workerStdioEnabled?: boolean;
      readonly includeShopifySecret?: boolean;
    }) {
      const trustedRuntimeRoot = await copyAgentFixtures(
        "mcp-commerce-dual-read-agent.ts",
      );
      const integrity = await agentIntegrity(
        trustedRuntimeRoot,
        "mcp-commerce-dual-read-agent.ts",
      );
      const secretEnv = fixtureShopifyTokenEnv(
        options.shopifyToken ?? FAKE_SHOPIFY_ACCESS_TOKEN,
      );
      const shared = {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
        ...secretEnv,
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
        ...(options.workerStdioEnabled === false ? {} : B7_1_STDIO_WORKER_ENV),
      });
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      return {
        origin,
        web,
        worker,
        integrity,
        includeShopifySecret: options.includeShopifySecret ?? true,
      };
    }

    async function seedDualConnectors(
      origin: string,
      includeShopifySecret = true,
    ) {
      const shopify = await seedShopifyShopGetTool({
        origin,
        transportConfig: buildShopifyFixtureTransportConfig({
          stdioEntry: resolveShopifyFixtureStdioEntry(),
          graphqlUrl: mockShopify.graphqlUrl,
          includeSecretReference: includeShopifySecret,
        }),
      });
      const ga4 = await seedGa4PropertyGetTool({
        origin,
        transportConfig: buildGa4FixtureTransportConfig({
          stdioEntry: resolveGa4FixtureStdioEntry(),
          dataApiOrigin: mockGa4.dataApiOrigin,
          adminApiOrigin: mockGa4.adminApiOrigin,
        }),
      });
      return { shopify, ga4 };
    }

    it("invokes shopify.shop.get and ga4.property.get in one Run with two TOOL RunSteps", async () => {
      const stack = await startStack({});
      try {
        const seeded = await seedDualConnectors(stack.origin);
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-3-commerce-dual",
          agentName: "B7.3 Commerce Dual Read",
          entrypoint: "mcp-commerce-dual-read-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [SHOPIFY_SHOP_GET_BINDING]: {
              toolVersionId: seeded.shopify.toolVersionId,
            },
            [GA4_PROPERTY_GET_BINDING]: {
              toolVersionId: seeded.ga4.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { propertyId: FIXTURE_GA4_PROPERTY_ID },
        });
        expect(run.terminalStatus).toBe("SUCCEEDED");
        expect(mockShopify.getRequestCount()).toBeGreaterThan(0);
        expect(mockGa4.getRequestCount()).toBeGreaterThan(0);

        const attempt = await fetchJson(
          `${stack.origin}/v1/runs/${run.runId}/attempts/${run.runAttemptId}`,
        );
        assertFixtureCombinedOutput(
          (attempt.body as { output?: unknown }).output,
        );

        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        const shopifyStep = assertToolRunStep({
          steps,
          toolVersionId: seeded.shopify.toolVersionId,
          bindingName: SHOPIFY_SHOP_GET_BINDING,
          status: "SUCCEEDED",
        });
        const ga4Step = assertToolRunStep({
          steps,
          toolVersionId: seeded.ga4.toolVersionId,
          bindingName: GA4_PROPERTY_GET_BINDING,
          status: "SUCCEEDED",
        });
        expect(shopifyStep.toolVersionId).not.toEqual(ga4Step.toolVersionId);

        const secrets = [FAKE_SHOPIFY_ACCESS_TOKEN, FAKE_GA4_ACCESS_TOKEN];
        assertNoCommerceSecretLeakInJson(JSON.stringify(attempt.body), secrets);
        assertNoCommerceSecretLeakInJson(JSON.stringify(steps), secrets);
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockShopify.close();
        await mockGa4.close();
      }
    }, 240_000);

    it("fails Shopify discover when the access token secret reference cannot be resolved", async () => {
      const web = createWebProcess(
        withTestAuthEnv({
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_WEB_HOST: "127.0.0.1",
          OSVA_WEB_PORT: "0",
          ...B7_1_STDIO_WEB_ENV,
          OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
        }),
      );
      try {
        const port = await web.listen();
        const origin = `http://127.0.0.1:${String(port)}`;
        const connector = await fetchJson(`${origin}/v1/connectors`, {
          method: "POST",
          body: {
            key: "b7-3-missing-shopify-secret",
            name: "Missing Shopify Secret",
          },
        });
        const connectorId = (connector.body as { id: string }).id;
        const version = await fetchJson(
          `${origin}/v1/connectors/${connectorId}/versions`,
          {
            method: "POST",
            body: {
              kind: "MCP",
              transport: "STDIO",
              transportConfig: buildShopifyFixtureTransportConfig({
                stdioEntry: resolveShopifyFixtureStdioEntry(),
                graphqlUrl: mockShopify.graphqlUrl,
              }),
            },
          },
        );
        expect(version.status).toBe(201);
        const connectorVersionId = (version.body as { id: string }).id;
        const discovered = await fetchJson(
          `${origin}/v1/connectors/${connectorId}/versions/${connectorVersionId}/discover`,
          { method: "POST", body: {} },
        );
        expect(discovered.status).toBeGreaterThanOrEqual(400);
      } finally {
        await web.stop();
        await mockShopify.close();
        await mockGa4.close();
      }
    });

    it("records failed Shopify TOOL RunStep on invalid credentials without leaking token", async () => {
      const stack = await startStack({
        shopifyToken: "shpat_wrong_token_for_osva_b7_3_test",
      });
      try {
        const seeded = await seedDualConnectors(stack.origin);
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-3-shopify-bad-token",
          agentName: "B7.3 Shopify Bad Token",
          entrypoint: "mcp-commerce-dual-read-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [SHOPIFY_SHOP_GET_BINDING]: {
              toolVersionId: seeded.shopify.toolVersionId,
            },
            [GA4_PROPERTY_GET_BINDING]: {
              toolVersionId: seeded.ga4.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { propertyId: FIXTURE_GA4_PROPERTY_ID },
        });
        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        const shopifyStep = assertToolRunStep({
          steps,
          toolVersionId: seeded.shopify.toolVersionId,
          bindingName: SHOPIFY_SHOP_GET_BINDING,
          status: "FAILED",
        });
        assertNoCommerceSecretLeakInJson(JSON.stringify(shopifyStep), [
          "shpat_wrong",
        ]);
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockShopify.close();
        await mockGa4.close();
      }
    }, 180_000);

    it("isolates GA4 provider 403 on a failed TOOL step while Shopify binding remains registered", async () => {
      mockGa4.setMode("forbidden");
      const stack = await startStack({});
      try {
        const seeded = await seedDualConnectors(stack.origin);
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-3-ga4-forbidden",
          agentName: "B7.3 GA4 Forbidden",
          entrypoint: "mcp-commerce-dual-read-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [SHOPIFY_SHOP_GET_BINDING]: {
              toolVersionId: seeded.shopify.toolVersionId,
            },
            [GA4_PROPERTY_GET_BINDING]: {
              toolVersionId: seeded.ga4.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { propertyId: FIXTURE_GA4_PROPERTY_ID },
        });
        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        assertToolRunStep({
          steps,
          toolVersionId: seeded.shopify.toolVersionId,
          bindingName: SHOPIFY_SHOP_GET_BINDING,
          status: "SUCCEEDED",
        });
        assertToolRunStep({
          steps,
          toolVersionId: seeded.ga4.toolVersionId,
          bindingName: GA4_PROPERTY_GET_BINDING,
          status: "FAILED",
        });
        expect(run.terminalStatus).not.toBe("SUCCEEDED");
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockShopify.close();
        await mockGa4.close();
      }
    }, 180_000);

    it("sanitizes Shopify 5xx provider diagnostics", async () => {
      mockShopify.setMode("server_error");
      const stack = await startStack({});
      try {
        const seeded = await seedDualConnectors(stack.origin);
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-3-shopify-5xx",
          agentName: "B7.3 Shopify 5xx",
          entrypoint: "mcp-commerce-dual-read-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [SHOPIFY_SHOP_GET_BINDING]: {
              toolVersionId: seeded.shopify.toolVersionId,
            },
            [GA4_PROPERTY_GET_BINDING]: {
              toolVersionId: seeded.ga4.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { propertyId: FIXTURE_GA4_PROPERTY_ID },
        });
        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        const shopifyStep = assertToolRunStep({
          steps,
          toolVersionId: seeded.shopify.toolVersionId,
          bindingName: SHOPIFY_SHOP_GET_BINDING,
          status: "FAILED",
        });
        assertNoCommerceSecretLeakInJson(JSON.stringify(shopifyStep), [
          FAKE_SHOPIFY_ACCESS_TOKEN,
        ]);
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockShopify.close();
        await mockGa4.close();
      }
    }, 180_000);

    it("surfaces GA4 rate limit as failed TOOL step", async () => {
      mockGa4.setMode("rate_limit");
      const stack = await startStack({});
      try {
        const seeded = await seedDualConnectors(stack.origin);
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-3-ga4-429",
          agentName: "B7.3 GA4 Rate Limit",
          entrypoint: "mcp-commerce-dual-read-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [SHOPIFY_SHOP_GET_BINDING]: {
              toolVersionId: seeded.shopify.toolVersionId,
            },
            [GA4_PROPERTY_GET_BINDING]: {
              toolVersionId: seeded.ga4.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { propertyId: FIXTURE_GA4_PROPERTY_ID },
        });
        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        assertToolRunStep({
          steps,
          toolVersionId: seeded.ga4.toolVersionId,
          bindingName: GA4_PROPERTY_GET_BINDING,
          status: "FAILED",
        });
        expect(run.terminalStatus).not.toBe("SUCCEEDED");
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockShopify.close();
        await mockGa4.close();
      }
    }, 180_000);

    it("fails tool execution when worker STDIO gate is disabled", async () => {
      const stack = await startStack({ workerStdioEnabled: false });
      try {
        const seeded = await seedDualConnectors(stack.origin);
        const agents = await createTrustedTypescriptAgent({
          origin: stack.origin,
          agentKey: "b7-3-worker-stdio-off",
          agentName: "B7.3 Worker STDIO Off",
          entrypoint: "mcp-commerce-dual-read-agent.ts",
          integrity: stack.integrity,
          toolBindings: {
            [SHOPIFY_SHOP_GET_BINDING]: {
              toolVersionId: seeded.shopify.toolVersionId,
            },
            [GA4_PROPERTY_GET_BINDING]: {
              toolVersionId: seeded.ga4.toolVersionId,
            },
          },
        });
        const run = await createAndAwaitRun({
          origin: stack.origin,
          agentId: agents.agentId,
          agentVersionId: agents.agentVersionId,
          runInput: { propertyId: FIXTURE_GA4_PROPERTY_ID },
        });
        expect(run.terminalStatus).toBe("FAILED");
        const steps = await loadRunSteps(
          stack.origin,
          run.runId,
          run.runAttemptId,
        );
        expect(
          steps.some(
            (step) =>
              step.kind === "TOOL" &&
              (step.status === "FAILED" || step.status === "CANCELLED"),
          ),
        ).toBe(true);
      } finally {
        await stack.worker.stop();
        await stack.web.stop();
        await mockShopify.close();
        await mockGa4.close();
      }
    }, 180_000);
  },
);
