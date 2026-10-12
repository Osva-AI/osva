import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMMUNITY_EDITION_ROLES,
  PUBLIC_API_ERROR_CODES,
  type WorkspaceId,
} from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresApiKeyRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import {
  Workspace,
  createApiKeyApplication,
  toRequestPrincipal,
} from "@osva/domain";

import { createWebProcess, type WebProcess } from "../../src/process.js";
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

const NOW = new Date("2026-01-15T12:00:00.000Z");

interface RecordedResponse {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfter: string | null;
  readonly requestId: string | null;
}

describe("two web processes share Valkey rate limits", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let seedDatabase: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    seedDatabase = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(seedDatabase);
  });

  afterAll(async () => {
    if (seedDatabase) {
      await seedDatabase.close();
    }
    if (postgres) {
      await stopPostgresForTests(postgres);
    }
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  it("enforces shared unauthenticated and authenticated buckets across processes", async () => {
    await resetStage0Tables(seedDatabase);
    const workspaces = new PostgresWorkspaceRepository(seedDatabase);
    const workspace = Workspace.create({
      id: "ws-two-process-rl" as WorkspaceId,
      name: "Two Process Rate Limit",
      createdAt: NOW,
    });
    await workspaces.save(workspace);
    const apiKeys = new PostgresApiKeyRepository(seedDatabase);
    const application = createApiKeyApplication({
      apiKeys,
      workspaces,
      clock: { now: () => NOW },
      ids: { createId: () => randomUUID() },
    });
    const boot = await application.bootstrapInstallation.execute({
      workspaceId: workspace.id,
    });
    const second = await application.createWorkspaceApiKey.execute(
      {
        principal: toRequestPrincipal(
          boot.apiKey.id,
          workspace.id,
          COMMUNITY_EDITION_ROLES.ADMIN,
        ),
      },
      { name: "second-admin", role: COMMUNITY_EDITION_ROLES.ADMIN },
    );

    const envA = webEnv(postgres.connectionString, valkey.url);
    const envB = webEnv(postgres.connectionString, valkey.url);
    const processA = createWebProcess(envA);
    const processB = createWebProcess(envB);
    let portA = 0;
    let portB = 0;

    try {
      portA = await processA.listen();
      portB = await processB.listen();
      const originA = `http://127.0.0.1:${String(portA)}`;
      const originB = `http://127.0.0.1:${String(portB)}`;
      console.log(
        JSON.stringify({
          event: "two_process_rate_limit.listening",
          processA: { host: "127.0.0.1", port: portA, origin: originA },
          processB: { host: "127.0.0.1", port: portB, origin: originB },
          valkeyUrlHostOnly: valkeyUrlHost(valkey.url),
          limits: { unauthenticated: 2, authenticated: 2 },
        }),
      );

      const healthA = await record(`${originA}/health`);
      const healthB = await record(`${originB}/health`);
      expect(healthA.status).toBe(200);
      expect(healthB.status).toBe(200);
      expect(healthA.body).toEqual({ status: "ok" });

      const unauthA1 = await record(`${originA}/v1/auth/context`);
      const unauthA2 = await record(`${originA}/v1/auth/context`);
      const unauthB = await record(`${originB}/v1/auth/context`);
      expect(unauthA1.status).toBe(401);
      expect(unauthA2.status).toBe(401);
      expectRateLimited(unauthB);
      expectUnauthenticatedEnvelope(unauthB);
      console.log(
        JSON.stringify({
          step: "shared_unauthenticated_bucket",
          unauthA1: unauthA1.status,
          unauthA2: unauthA2.status,
          unauthB: unauthB,
        }),
      );

      const spoof = await record(`${originB}/v1/auth/context`, {
        "x-forwarded-for": "203.0.113.9",
      });
      expectRateLimited(spoof);
      console.log(
        JSON.stringify({
          step: "spoofed_x_forwarded_for_ignored",
          status: spoof.status,
          body: spoof.body,
        }),
      );

      const invalidBearerA = await record(`${originA}/v1/auth/context`, {
        authorization: "Bearer osva_ak_missing.not-a-secret",
      });
      expectRateLimited(invalidBearerA);
      expect(JSON.stringify(invalidBearerA.body)).not.toMatch(
        /osva_ak_|not-a-secret/i,
      );
      console.log(
        JSON.stringify({
          step: "invalid_bearer_uses_unauth_bucket",
          status: invalidBearerA.status,
          body: invalidBearerA.body,
        }),
      );

      const authA1 = await record(`${originA}/v1/auth/context`, {
        authorization: `Bearer ${boot.plaintextToken}`,
      });
      const authA2 = await record(`${originA}/v1/auth/context`, {
        authorization: `Bearer ${boot.plaintextToken}`,
      });
      const authBSameKey = await record(`${originB}/v1/auth/context`, {
        authorization: `Bearer ${boot.plaintextToken}`,
      });
      expect(authA1.status).toBe(200);
      expect(authA2.status).toBe(200);
      expectRateLimited(authBSameKey);
      expect(JSON.stringify(authBSameKey.body)).not.toContain(
        boot.plaintextToken,
      );
      console.log(
        JSON.stringify({
          step: "shared_authenticated_bucket_across_processes",
          authA1: authA1.status,
          authA2: authA2.status,
          authBSameKey,
        }),
      );

      const otherKey = await record(`${originB}/v1/auth/context`, {
        authorization: `Bearer ${second.plaintextToken}`,
      });
      expect(otherKey.status).toBe(200);
      expect(JSON.stringify(otherKey.body)).not.toContain(
        second.plaintextToken,
      );
      console.log(
        JSON.stringify({
          step: "independent_api_key_bucket",
          status: otherKey.status,
          body: otherKey.body,
        }),
      );

      const deadProcess = createWebProcess(
        webEnv(postgres.connectionString, "redis://127.0.0.1:1"),
      );
      try {
        const deadPort = await deadProcess.listen();
        const deadOrigin = `http://127.0.0.1:${String(deadPort)}`;
        const outage = await record(
          `${deadOrigin}/v1/auth/context`,
          { authorization: `Bearer ${second.plaintextToken}` },
          8_000,
        );
        const healthDuringOutage = await record(`${deadOrigin}/health`);
        expect(outage.status).toBe(503);
        expect(outage.body).toMatchObject({
          status: "error",
          code: PUBLIC_API_ERROR_CODES.SERVICE_UNAVAILABLE,
        });
        expect(outage.retryAfter).toBeNull();
        expect(healthDuringOutage.status).toBe(200);
        console.log(
          JSON.stringify({
            step: "valkey_outage_fail_closed",
            deadProcess: { host: "127.0.0.1", port: deadPort },
            outage,
            healthDuringOutage,
          }),
        );
      } finally {
        await stopQuietly(deadProcess);
      }

      const recovered = await record(`${originB}/v1/auth/context`, {
        authorization: `Bearer ${second.plaintextToken}`,
      });
      expect(recovered.status).toBe(200);
      const healthAfter = await record(`${originB}/health`);
      expect(healthAfter.status).toBe(200);
      console.log(
        JSON.stringify({
          step: "healthy_processes_continue_after_peer_store_outage",
          recovered,
          healthAfter,
        }),
      );
    } finally {
      await stopQuietly(processA);
      await stopQuietly(processB);
    }
  }, 180_000);
});

function webEnv(databaseUrl: string, valkeyUrl: string): NodeJS.ProcessEnv {
  return {
    OSVA_DATABASE_URL: databaseUrl,
    OSVA_VALKEY_URL: valkeyUrl,
    OSVA_WEB_HOST: "127.0.0.1",
    OSVA_WEB_PORT: "0",
    OSVA_RATE_LIMIT_UNAUTH_PER_MINUTE: "2",
    OSVA_RATE_LIMIT_AUTH_PER_MINUTE: "2",
  };
}

async function record(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs?: number,
): Promise<RecordedResponse> {
  const response = await fetch(url, {
    headers,
    signal:
      timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return {
    status: response.status,
    body,
    retryAfter: response.headers.get("retry-after"),
    requestId: response.headers.get("x-osva-request-id"),
  };
}

function expectRateLimited(response: RecordedResponse): void {
  expect(response.status).toBe(429);
  expect(response.body).toMatchObject({
    status: "error",
    code: PUBLIC_API_ERROR_CODES.RATE_LIMITED,
  });
  expect(response.retryAfter).toEqual(expect.stringMatching(/^[1-9]\d*$/));
  expect(response.requestId).toEqual(expect.any(String));
}

function expectUnauthenticatedEnvelope(response: RecordedResponse): void {
  expect(response.body).toEqual({
    status: "error",
    code: PUBLIC_API_ERROR_CODES.RATE_LIMITED,
    requestId: response.requestId,
  });
}

async function stopQuietly(process: WebProcess): Promise<void> {
  try {
    await process.stop();
  } catch {
    // Test cleanup.
  }
}

function valkeyUrlHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
  } catch {
    return "unparsed";
  }
}
