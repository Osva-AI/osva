import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_EDITION_ROLES,
  computeInferenceBudgetAvailableUsdMicros,
  createDefaultInferenceBudgetPolicyDefinition,
  type InferenceBudgetPeriodKeyV1,
  type InferenceBudgetPolicyVersionId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import {
  createApiKeyApplication,
  resolveInferenceBudgetUtcPeriodIdentity,
  Workspace,
} from "@osva/domain";
import {
  createDatabase,
  migrateDatabase,
  PostgresApiKeyRepository,
  PostgresInferenceBudgetAdmissionRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { workspaceInferenceBudgetPeriods } from "../../../../packages/db/src/schema/workspace-inference-budget-periods.js";

import { createWebProcess } from "../../src/process.js";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
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

const WS_A = "ws-budget-http-a" as WorkspaceId;
const WS_B = "ws-budget-http-b" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const PERIOD_KEY = "2026-01" as InferenceBudgetPeriodKeyV1;

const POLICY_BODY = {
  key: "default",
  definition: {
    ...createDefaultInferenceBudgetPolicyDefinition(),
    periodLimitUsdMicros: 10_000_000,
  },
};

describe("B5.5A inference budget control-plane API", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let adminTokenA: string;
  let viewerTokenA: string;
  let adminTokenB: string;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 8,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    const apiKeys = new PostgresApiKeyRepository(database);
    const clock = { now: () => NOW };
    const ids = { createId: () => randomUUID() };

    for (const [id, name] of [
      [WS_A, "Budget A"],
      [WS_B, "Budget B"],
    ] as const) {
      await workspaces.save(Workspace.create({ id, name, createdAt: NOW }));
    }

    const apiKeyApp = createApiKeyApplication({
      apiKeys,
      workspaces,
      clock,
      ids,
    });

    const adminA = await apiKeyApp.createApiKey.execute({
      workspaceId: WS_A,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      name: "admin-a",
    });
    adminTokenA = adminA.plaintextToken;

    const viewerA = await apiKeyApp.createApiKey.execute({
      workspaceId: WS_A,
      role: COMMUNITY_EDITION_ROLES.VIEWER,
      name: "viewer-a",
    });
    viewerTokenA = viewerA.plaintextToken;

    const adminB = await apiKeyApp.createApiKey.execute({
      workspaceId: WS_B,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
      name: "admin-b",
    });
    adminTokenB = adminB.plaintextToken;
  });

  it("P1–P15 control-plane acceptance scenarios", async () => {
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
        OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
      }),
    );

    const policies = new PostgresInferenceBudgetPolicyRepository(database);
    const admission = new PostgresInferenceBudgetAdmissionRepository(database);

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;

      const created = await fetchJson(
        `${origin}/v1/inference-budget-policies`,
        {
          method: "POST",
          body: POLICY_BODY,
          apiKeyToken: adminTokenA,
        },
      );
      expect(created.status).toBe(201);

      const policyId = (created.body as { policy: { id: string } }).policy.id;
      const versionId = (created.body as { version: { id: string } }).version
        .id;

      const nonAdmin = await fetchJson(
        `${origin}/v1/inference-budget-policies`,
        {
          method: "POST",
          body: { ...POLICY_BODY, key: "other" },
          apiKeyToken: viewerTokenA,
        },
      );
      expect(nonAdmin.status).toBe(403);

      const crossRead = await fetchJson(
        `${origin}/v1/inference-budget-policy-versions/${versionId}`,
        { apiKeyToken: adminTokenB },
      );
      expect(crossRead.status).toBe(404);

      const crossAppend = await fetchJson(
        `${origin}/v1/inference-budget-policies/${policyId}/versions`,
        {
          method: "POST",
          body: {
            definition: {
              ...POLICY_BODY.definition,
              periodLimitUsdMicros: 20_000_000,
            },
          },
          apiKeyToken: adminTokenB,
        },
      );
      expect(crossAppend.status).toBe(404);

      const append = await fetchJson(
        `${origin}/v1/inference-budget-policies/${policyId}/versions`,
        {
          method: "POST",
          body: {
            definition: {
              ...POLICY_BODY.definition,
              periodLimitUsdMicros: 12_000_000,
            },
          },
          apiKeyToken: adminTokenA,
        },
      );
      expect(append.status).toBe(201);
      const v2 = append.body as { version: number; id: string };
      expect(v2.version).toBe(2);

      const v1Read = await fetchJson(
        `${origin}/v1/inference-budget-policy-versions/${versionId}`,
        { apiKeyToken: adminTokenA },
      );
      expect(v1Read.status).toBe(200);
      expect(
        (v1Read.body as { definition: { periodLimitUsdMicros: number } })
          .definition.periodLimitUsdMicros,
      ).toBe(10_000_000);

      const configuration = await fetchJson(
        `${origin}/v1/workspace-inference-budget/configuration`,
        { apiKeyToken: adminTokenA },
      );
      expect(configuration.status).toBe(200);
      const configBody = configuration.body as {
        activation: { enabled: boolean };
        runtimePolicy: { enabled: boolean };
        activationMutationsPermitted: boolean;
      };
      expect(configBody.activation.enabled).toBe(false);
      expect(configBody.runtimePolicy.enabled).toBe(false);
      expect(configBody.activationMutationsPermitted).toBe(false);

      const periodIdentity = resolveInferenceBudgetUtcPeriodIdentity(NOW);
      await seedPeriodLedger(
        database,
        WS_A,
        PERIOD_KEY,
        versionId as InferenceBudgetPolicyVersionId,
        periodIdentity,
      );

      const usage = await fetchJson(
        `${origin}/v1/workspace-inference-budget/period-usage?periodKey=${PERIOD_KEY}`,
        { apiKeyToken: adminTokenA },
      );
      expect(usage.status).toBe(200);
      const usageBody = usage.body as {
        ledger: {
          committedLiabilityUsdMicros: number;
          heldReservationsUsdMicros: number;
          unresolvedUncertainLiabilityUsdMicros: number;
          overageUsdMicros: number;
          limitUsdMicros: number;
        };
        availableReservationCapacityUsdMicros: number;
      };
      expect(usageBody.ledger.unresolvedUncertainLiabilityUsdMicros).toBe(
        250_000,
      );
      const expectedAvailable = computeInferenceBudgetAvailableUsdMicros(
        usageBody.ledger,
      );
      expect(usageBody.availableReservationCapacityUsdMicros).toBe(
        expectedAvailable,
      );
      expect(usageBody.ledger.overageUsdMicros).toBe(50_000);
      expect(expectedAvailable).toBe(
        usageBody.ledger.limitUsdMicros -
          usageBody.ledger.committedLiabilityUsdMicros -
          usageBody.ledger.heldReservationsUsdMicros -
          usageBody.ledger.unresolvedUncertainLiabilityUsdMicros,
      );

      const unauthorized = await fetchJson(
        `${origin}/v1/inference-budget-policies`,
        { apiKeyToken: "osva_invalid_token" },
      );
      expect(unauthorized.status).toBe(401);

      const routingList = await fetchJson(
        `${origin}/v1/inference-routing-policies`,
        { apiKeyToken: adminTokenA },
      );
      expect(routingList.status).toBe(200);

      const ledgerBefore = await admission.loadPeriodLedger(WS_A, PERIOD_KEY);
      await fetchJson(`${origin}/v1/workspace-inference-budget/period-usage`, {
        apiKeyToken: adminTokenA,
      });
      const ledgerAfter = await admission.loadPeriodLedger(WS_A, PERIOD_KEY);
      expect(ledgerAfter).toEqual(ledgerBefore);

      await policies.upsertWorkspaceActivation({
        workspaceId: WS_A,
        enabled: false,
        updatedAt: NOW,
      });
      const disabledConfig = await fetchJson(
        `${origin}/v1/workspace-inference-budget/configuration`,
        { apiKeyToken: adminTokenA },
      );
      expect(
        (disabledConfig.body as { runtimePolicy: { enabled: boolean } })
          .runtimePolicy.enabled,
      ).toBe(false);
    } finally {
      await web.stop();
    }
  });
});

async function seedPeriodLedger(
  database: Database,
  workspaceId: WorkspaceId,
  periodKey: InferenceBudgetPeriodKeyV1,
  budgetPolicyVersionId: InferenceBudgetPolicyVersionId,
  period: ReturnType<typeof resolveInferenceBudgetUtcPeriodIdentity>,
) {
  await database.db.insert(workspaceInferenceBudgetPeriods).values({
    id: randomUUID(),
    workspaceId,
    periodKind: "CALENDAR_MONTH_UTC",
    periodKey,
    periodStartUtc: new Date(period.periodStartUtc),
    periodEndExclusiveUtc: new Date(period.periodEndExclusiveUtc),
    budgetPolicyVersionId,
    limitUsdMicros: 10_000_000,
    committedLiabilityUsdMicros: 1_000_000,
    heldReservationsUsdMicros: 500_000,
    unresolvedUncertainLiabilityUsdMicros: 250_000,
    overageUsdMicros: 50_000,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function fetchJson(
  url: string,
  init: { method?: string; body?: unknown; apiKeyToken?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (init.apiKeyToken !== undefined) {
    headers.authorization = `Bearer ${init.apiKeyToken}`;
  }
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = response.status === 204 ? null : await response.json();
  return { status: response.status, body };
}
