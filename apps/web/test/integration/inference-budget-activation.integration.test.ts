import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_EDITION_ROLES,
  SECURITY_AUDIT_EVENT_TYPES,
  createDefaultInferenceBudgetPolicyDefinition,
  type InferenceBudgetPolicyVersionId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import { Workspace, createApiKeyApplication } from "@osva/domain";
import {
  createDatabase,
  migrateDatabase,
  PostgresApiKeyRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";

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

const WS_A = "ws-budget-act-a" as WorkspaceId;
const WS_B = "ws-budget-act-b" as WorkspaceId;
const NOW = new Date("2026-02-15T12:00:00.000Z");

const POLICY_BODY = {
  key: "default",
  definition: {
    ...createDefaultInferenceBudgetPolicyDefinition(),
    periodLimitUsdMicros: 10_000_000,
  },
};

function baseEnv(postgres: PostgresTestContext, valkey: ValkeyTestContext) {
  return withTestAuthEnv({
    OSVA_DATABASE_URL: postgres.connectionString,
    OSVA_VALKEY_URL: valkey.url,
    OSVA_WEB_HOST: "127.0.0.1",
    OSVA_WEB_PORT: "0",
    OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
    OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
  });
}

function gateOnEnv(postgres: PostgresTestContext, valkey: ValkeyTestContext) {
  return {
    ...baseEnv(postgres, valkey),
    OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED: "true",
  };
}

describe("B5.5C.3 inference budget activation API", () => {
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

    adminTokenA = (
      await apiKeyApp.createApiKey.execute({
        workspaceId: WS_A,
        role: COMMUNITY_EDITION_ROLES.ADMIN,
        name: "admin-a",
      })
    ).plaintextToken;

    viewerTokenA = (
      await apiKeyApp.createApiKey.execute({
        workspaceId: WS_A,
        role: COMMUNITY_EDITION_ROLES.VIEWER,
        name: "viewer-a",
      })
    ).plaintextToken;

    adminTokenB = (
      await apiKeyApp.createApiKey.execute({
        workspaceId: WS_B,
        role: COMMUNITY_EDITION_ROLES.ADMIN,
        name: "admin-b",
      })
    ).plaintextToken;
  });

  async function createPolicyVersion(
    origin: string,
    token: string,
  ): Promise<string> {
    const created = await fetchJson(`${origin}/v1/inference-budget-policies`, {
      method: "POST",
      body: POLICY_BODY,
      apiKeyToken: token,
    });
    expect(created.status).toBe(201);
    return (created.body as { version: { id: string } }).version.id;
  }

  it("ACT1–ACT2: feature gate off rejects activation; read-only still works", async () => {
    const web = createWebProcess(baseEnv(postgres, valkey));
    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const versionId = await createPolicyVersion(origin, adminTokenA);

      const config = await fetchJson(
        `${origin}/v1/workspace-inference-budget/configuration`,
        { apiKeyToken: adminTokenA },
      );
      expect(config.status).toBe(200);
      expect(
        (config.body as { activationMutationsPermitted: boolean })
          .activationMutationsPermitted,
      ).toBe(false);

      const activate = await fetchJson(
        `${origin}/v1/workspace-inference-budget/activate`,
        {
          method: "POST",
          body: { policyVersionId: versionId },
          apiKeyToken: adminTokenA,
        },
      );
      expect(activate.status).toBe(403);

      const policies = await fetchJson(
        `${origin}/v1/inference-budget-policies`,
        { apiKeyToken: adminTokenA },
      );
      expect(policies.status).toBe(200);
    } finally {
      await web.stop();
    }
  });

  it("ACT3–ACT10: activation mutations with gate on", async () => {
    const web = createWebProcess(gateOnEnv(postgres, valkey));
    const policies = new PostgresInferenceBudgetPolicyRepository(database);
    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const versionId = await createPolicyVersion(origin, adminTokenA);

      const viewerActivate = await fetchJson(
        `${origin}/v1/workspace-inference-budget/activate`,
        {
          method: "POST",
          body: { policyVersionId: versionId },
          apiKeyToken: viewerTokenA,
        },
      );
      expect(viewerActivate.status).toBe(403);

      const crossActivate = await fetchJson(
        `${origin}/v1/workspace-inference-budget/activate`,
        {
          method: "POST",
          body: { policyVersionId: versionId },
          apiKeyToken: adminTokenB,
        },
      );
      expect(crossActivate.status).toBe(404);

      const invalid = await fetchJson(
        `${origin}/v1/workspace-inference-budget/activate`,
        {
          method: "POST",
          body: {
            policyVersionId: "00000000-0000-4000-8000-000000000000",
          },
          apiKeyToken: adminTokenA,
        },
      );
      expect(invalid.status).toBe(404);

      const activated = await fetchJson(
        `${origin}/v1/workspace-inference-budget/activate`,
        {
          method: "POST",
          body: { policyVersionId: versionId },
          apiKeyToken: adminTokenA,
        },
      );
      expect(activated.status).toBe(200);
      const body = activated.body as {
        activation: { enabled: boolean; activePolicyVersionId: string };
        runtimePolicy: { enabled: boolean; policyVersionId: string };
      };
      expect(body.activation.enabled).toBe(true);
      expect(body.activation.activePolicyVersionId).toBe(versionId);
      expect(body.runtimePolicy.enabled).toBe(true);

      const repeat = await fetchJson(
        `${origin}/v1/workspace-inference-budget/activate`,
        {
          method: "POST",
          body: { policyVersionId: versionId },
          apiKeyToken: adminTokenA,
        },
      );
      expect(repeat.status).toBe(200);

      const auditRows = await database.sql`
        SELECT event_type, workspace_id
        FROM security_audit_events
        WHERE workspace_id = ${WS_A}
          AND event_type = ${SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_INFERENCE_BUDGET_ACTIVATION_CHANGED}
      `;
      expect(auditRows.length).toBe(1);

      const disabled = await fetchJson(
        `${origin}/v1/workspace-inference-budget/disable`,
        {
          method: "POST",
          body: {},
          apiKeyToken: adminTokenA,
        },
      );
      expect(disabled.status).toBe(200);
      expect(
        (disabled.body as { activation: { enabled: boolean } }).activation
          .enabled,
      ).toBe(false);

      const repeatDisable = await fetchJson(
        `${origin}/v1/workspace-inference-budget/disable`,
        {
          method: "POST",
          body: {},
          apiKeyToken: adminTokenA,
        },
      );
      expect(repeatDisable.status).toBe(200);

      const activationRead = await fetchJson(
        `${origin}/v1/workspace-inference-budget/activation`,
        { apiKeyToken: adminTokenA },
      );
      expect(activationRead.status).toBe(200);
      expect(
        (activationRead.body as { activationMutationsPermitted: boolean })
          .activationMutationsPermitted,
      ).toBe(true);

      await policies.upsertWorkspaceActivation({
        workspaceId: WS_A,
        enabled: true,
        activePolicyVersionId: versionId as InferenceBudgetPolicyVersionId,
        updatedAt: NOW,
      });

      const concurrent = await Promise.all([
        fetchJson(`${origin}/v1/workspace-inference-budget/activate`, {
          method: "POST",
          body: { policyVersionId: versionId },
          apiKeyToken: adminTokenA,
        }),
        fetchJson(`${origin}/v1/workspace-inference-budget/disable`, {
          method: "POST",
          body: {},
          apiKeyToken: adminTokenA,
        }),
      ]);
      expect(concurrent.every((r) => r.status === 200)).toBe(true);
      const finalActivation = await policies.findWorkspaceActivation(WS_A);
      expect(finalActivation).not.toBeNull();
    } finally {
      await web.stop();
    }
  });
});

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
