import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";

import { BetterAuthOperatorPasswordTokenService } from "@osva/adapters-auth";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { startFakeHttpMcpServer } from "@osva/adapters-mcp-client/testing";
import {
  HUMAN_WORKSPACE_ROLES,
  type UserId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import type { WorkspaceMembershipId } from "@osva-ai/contracts";
import {
  IdentityBootstrapApplication,
  Workspace,
  WorkspaceMembership,
} from "@osva/domain";
import {
  createDatabase,
  migrateDatabase,
  PostgresIdentityLifecycleRepository,
  PostgresOrganizationRepository,
  PostgresSecurityAuditEventRepository,
  PostgresUserRepository,
  PostgresWorkspaceMembershipRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";

import { startFakeGeminiGenerateContentServer } from "../../../../adapters/model-gemini/test/fake-gemini-server.js";
import { createWebProcess } from "../../../web/src/process.js";
import {
  createWorkerProcess,
  type WorkerProcessDependencies,
} from "../../../worker/src/process.js";
import { bootstrapIntegrationAuth } from "../../../worker/test/integration/integration-auth.js";
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
import { TEST_AUTH_SECRET } from "../../../../packages/db/test/integration/web-auth-env.js";
import { createConsoleServer } from "../../src/server/server.js";
import {
  allocateWebAndConsolePorts,
  loopbackOrigin,
} from "./allocate-loopback-port.js";
import { pollUntil } from "./poll-deadline.js";

export const SENTINEL_CREDENTIAL = "osva-m12-3-sentinel-credential-NEVER-LEAK";
export const OWNER_EMAIL = "owner.m12-3@test.local";
export const OPERATOR_EMAIL = "operator.m12-3@test.local";
export const HUMAN_PASSWORD = "M12-3-Human-Console-Pw-12!";
export const NOW = new Date("2026-03-01T12:00:00.000Z");
export const TEST_GEMINI_API_KEY = "osva-m12-3-test-gemini-key";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

const consoleClientDistDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/client",
);

export class CookieJar {
  private readonly store = new Map<string, string>();

  absorb(response: Response): void {
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const raw =
      headers.getSetCookie?.() ??
      (response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie")!]
        : []);
    for (const line of raw) {
      const pair = line.split(";")[0]?.trim();
      if (pair === undefined || pair.length === 0) {
        continue;
      }
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value.length === 0 || line.toLowerCase().includes("max-age=0")) {
        this.store.delete(name);
      } else {
        this.store.set(name, value);
      }
    }
  }

  header(): string | undefined {
    if (this.store.size === 0) {
      return undefined;
    }
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export interface M12_3Stack {
  readonly webOrigin: string;
  readonly consoleOrigin: string;
  readonly jar: CookieJar;
  readonly workspaceA: WorkspaceId;
  readonly workspaceB: WorkspaceId;
  readonly trustedRuntimeRoot: string;
  readonly fakeOpenAI: Awaited<
    ReturnType<typeof startFakeOpenAIResponsesServer>
  >;
  readonly fakeMcp: Awaited<ReturnType<typeof startFakeHttpMcpServer>>;
  readonly fakeGemini?: Awaited<
    ReturnType<typeof startFakeGeminiGenerateContentServer>
  >;
  consoleHeaders(workspaceId: WorkspaceId): Record<string, string>;
  copyAgentFixture(filename: string): Promise<string>;
  close(): Promise<void>;
}

export async function startM12_3Infra(): Promise<{
  postgres: PostgresTestContext;
  valkey: ValkeyTestContext;
  database: Database;
}> {
  const postgres = await startPostgresForTests();
  const valkey = await startValkeyForTests();
  const database = createDatabase({
    connectionString: postgres.connectionString,
    max: 8,
    connectTimeoutSeconds: 10,
  });
  await migrateDatabase(database);
  return { postgres, valkey, database };
}

export async function stopM12_3Infra(
  database: Database | undefined,
  postgres: PostgresTestContext | undefined,
  valkey: ValkeyTestContext | undefined,
): Promise<void> {
  await database?.close();
  if (postgres) {
    await stopPostgresForTests(postgres);
  }
  if (valkey) {
    await stopValkeyForTests(valkey);
  }
}

export async function resetM12_3Data(database: Database): Promise<void> {
  await resetStage0Tables(database);
}

export async function bootstrapM12_3Workspaces(
  database: Database,
): Promise<{ workspaceA: WorkspaceId; workspaceB: WorkspaceId }> {
  const workspaceA = "ws-m12-3-a" as WorkspaceId;
  const workspaceB = "ws-m12-3-b" as WorkspaceId;
  const workspaces = new PostgresWorkspaceRepository(database);
  for (const [id, name] of [
    [workspaceA, "M12.3 Workspace A"],
    [workspaceB, "M12.3 Workspace B"],
  ] as const) {
    await workspaces.save(Workspace.create({ id, name, createdAt: NOW }));
  }
  await bootstrapIntegrationAuth(database, workspaceA, NOW, "M12.3 A");
  return { workspaceA, workspaceB };
}

async function bootstrapHumanOwner(database: Database): Promise<void> {
  const bootstrap = new IdentityBootstrapApplication({
    organizations: new PostgresOrganizationRepository(database),
    users: new PostgresUserRepository(database),
    workspaces: new PostgresWorkspaceRepository(database),
    workspaceMemberships: new PostgresWorkspaceMembershipRepository(database),
    lifecycle: new PostgresIdentityLifecycleRepository(database),
    securityAuditEvents: new PostgresSecurityAuditEventRepository(database),
    clock: { now: () => NOW },
    ids: { createId: () => randomUUID() },
  });
  await bootstrap.bootstrapExistingInstallation({
    organizationName: "M12.3 Org",
    ownerEmail: OWNER_EMAIL,
    ownerDisplayName: "M12.3 Owner",
    workspaceIds: ["ws-m12-3-a" as WorkspaceId],
    allUnlinkedWorkspaces: false,
  });
}

async function completeOwnerPassword(
  database: Database,
  webOrigin: string,
): Promise<string> {
  const passwordTokens = new BetterAuthOperatorPasswordTokenService({
    database,
    secret: TEST_AUTH_SECRET,
    baseURL: webOrigin,
    trustedOrigins: [webOrigin],
  });
  const issued = await passwordTokens.issuePasswordResetToken({
    email: OWNER_EMAIL,
    redirectTo: `${webOrigin}/v1/auth/setup/complete`,
  });
  const setup = await fetch(`${webOrigin}/v1/auth/setup/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: webOrigin },
    body: JSON.stringify({ token: issued.token, password: HUMAN_PASSWORD }),
  });
  if (setup.status !== 200) {
    throw new Error(`Owner setup failed: ${setup.status}`);
  }
  const login = await fetch(`${webOrigin}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: webOrigin },
    body: JSON.stringify({ email: OWNER_EMAIL, password: HUMAN_PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (login.status !== 200 || cookie.length === 0) {
    throw new Error(`Owner login failed: ${login.status}`);
  }
  return cookie;
}

async function provisionOperator(
  database: Database,
  webOrigin: string,
  ownerCookie: string,
  workspaceA: WorkspaceId,
  workspaceB: WorkspaceId,
): Promise<string> {
  const provision = await fetch(
    `${webOrigin}/v1/auth/workspaces/${workspaceA}/members/users`,
    {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: webOrigin,
        "x-osva-workspace-id": workspaceA,
      },
      body: JSON.stringify({
        email: OPERATOR_EMAIL,
        displayName: "M12.3 Operator",
        role: HUMAN_WORKSPACE_ROLES.ADMIN,
      }),
    },
  );
  if (provision.status !== 201) {
    throw new Error(`Failed to provision operator: ${provision.status}`);
  }
  const { setupToken, user } = (await provision.json()) as {
    setupToken: string;
    user: { userId: string };
  };

  await new PostgresWorkspaceMembershipRepository(database).save(
    WorkspaceMembership.create({
      id: randomUUID() as WorkspaceMembershipId,
      workspaceId: workspaceB,
      userId: user.userId as UserId,
      role: HUMAN_WORKSPACE_ROLES.OPERATOR,
      createdAt: NOW,
    }),
  );

  return setupToken;
}

async function activateOperatorViaConsoleBff(
  consoleOrigin: string,
  setupToken: string,
): Promise<CookieJar> {
  const jar = new CookieJar();
  const setup = await fetch(`${consoleOrigin}/api/v1/auth/setup/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: consoleOrigin },
    body: JSON.stringify({ token: setupToken, password: HUMAN_PASSWORD }),
  });
  jar.absorb(setup);
  if (setup.status !== 200) {
    throw new Error(`Operator Console setup failed: ${setup.status}`);
  }

  const login = await fetch(`${consoleOrigin}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: consoleOrigin },
    body: JSON.stringify({ email: OPERATOR_EMAIL, password: HUMAN_PASSWORD }),
  });
  jar.absorb(login);
  if (login.status !== 200) {
    throw new Error(`Operator Console login failed: ${login.status}`);
  }
  return jar;
}

export async function startM12_3HumanConsoleStack(options: {
  readonly database: Database;
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  /** Enables fake Gemini for deterministic unpriced model usage in browser tests. */
  readonly unpricedGemini?: boolean;
  readonly workerDependencies?: WorkerProcessDependencies;
}): Promise<M12_3Stack> {
  const { workspaceA, workspaceB } = await bootstrapM12_3Workspaces(
    options.database,
  );
  await bootstrapHumanOwner(options.database);

  const fakeOpenAI = await startFakeOpenAIResponsesServer();
  const fakeMcp = await startFakeHttpMcpServer();
  const fakeGemini = options.unpricedGemini
    ? await startFakeGeminiGenerateContentServer()
    : undefined;
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-m12-3-runtime-"),
  );

  const { webPort, consolePort } = await allocateWebAndConsolePorts();
  const consoleOrigin = loopbackOrigin(consolePort);
  const webOrigin = loopbackOrigin(webPort);

  const web = createWebProcess({
    OSVA_DATABASE_URL: options.databaseUrl,
    OSVA_VALKEY_URL: options.valkeyUrl,
    OSVA_WEB_HOST: "127.0.0.1",
    OSVA_WEB_PORT: String(webPort),
    OSVA_AUTH_SECRET: TEST_AUTH_SECRET,
    OSVA_AUTH_BASE_URL: webOrigin,
    OSVA_AUTH_TRUSTED_ORIGINS: [webOrigin, consoleOrigin].join(","),
    OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
    OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
    OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
    OSVA_RATE_LIMIT_UNAUTH_PER_MINUTE: "100000",
    OSVA_RATE_LIMIT_AUTH_PER_MINUTE: "100000",
    OPENAI_API_KEY: SENTINEL_CREDENTIAL,
    ...(fakeGemini !== undefined
      ? { GOOGLE_GEMINI_API_KEY: TEST_GEMINI_API_KEY }
      : {}),
  });

  const workerDependencies: WorkerProcessDependencies = {
    ...options.workerDependencies,
    ...(fakeGemini !== undefined
      ? {
          gemini: {
            apiKey: TEST_GEMINI_API_KEY,
            baseURL: fakeGemini.origin,
            ...options.workerDependencies?.gemini,
          },
        }
      : {}),
  };

  const worker = createWorkerProcess(
    {
      OSVA_DATABASE_URL: options.databaseUrl,
      OSVA_VALKEY_URL: options.valkeyUrl,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
      OPENAI_API_KEY: SENTINEL_CREDENTIAL,
      ...(fakeGemini !== undefined
        ? { GOOGLE_GEMINI_API_KEY: TEST_GEMINI_API_KEY }
        : {}),
    },
    (connectionString) => createDatabase({ connectionString, max: 5 }),
    workerDependencies,
  );

  let consoleServer: Server | undefined;
  try {
    await web.listen();
    await worker.start();

    const ownerCookie = await completeOwnerPassword(
      options.database,
      webOrigin,
    );
    const operatorSetupToken = await provisionOperator(
      options.database,
      webOrigin,
      ownerCookie,
      workspaceA,
      workspaceB,
    );

    consoleServer = createConsoleServer({
      config: {
        osvaBaseUrl: webOrigin,
        legacyApiKeyMode: false,
        host: "127.0.0.1",
        port: consolePort,
        clientDistDir: consoleClientDistDir,
        allowedOrigins: [],
        browserOrigin: consoleOrigin,
      },
    });
    await new Promise<void>((resolve) =>
      consoleServer!.listen(consolePort, resolve),
    );

    const jar = await activateOperatorViaConsoleBff(
      consoleOrigin,
      operatorSetupToken,
    );

    await pollUntil({
      label: "console BFF ready",
      deadlineMs: 60_000,
      probe: async () => {
        try {
          const response = await fetch(`${consoleOrigin}/api/v1/auth/session`, {
            headers: {
              cookie: jar.header() ?? "",
              origin: consoleOrigin,
            },
          });
          return { done: response.status === 200, lastState: response.status };
        } catch {
          return { done: false };
        }
      },
    });

    const consoleHeaders = (
      workspaceId: WorkspaceId,
    ): Record<string, string> => ({
      cookie: jar.header() ?? "",
      origin: consoleOrigin,
      "sec-fetch-site": "same-origin",
      "x-osva-workspace-id": workspaceId,
    });

    const copyAgentFixture = async (filename: string): Promise<string> => {
      await fs.copyFile(
        path.join(FIXTURE_DIR, filename),
        path.join(trustedRuntimeRoot, filename),
      );
      return sha256IntegrityOf(
        await fs.readFile(path.join(trustedRuntimeRoot, filename)),
      );
    };

    return {
      webOrigin,
      consoleOrigin,
      jar,
      workspaceA,
      workspaceB,
      trustedRuntimeRoot,
      fakeOpenAI,
      fakeMcp,
      fakeGemini,
      consoleHeaders,
      copyAgentFixture,
      close: async () => {
        // Close web (queue producer + rate limiter) before worker (consumer) so
        // Valkey clients quit before the disposable container is torn down.
        await web.stop();
        await worker.stop();
        await fakeOpenAI.close();
        await fakeMcp.close();
        if (fakeGemini !== undefined) {
          await fakeGemini.close();
        }
        if (consoleServer) {
          await new Promise<void>((resolve, reject) => {
            consoleServer!.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          });
        }
        await fs.rm(trustedRuntimeRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await web.stop().catch(() => undefined);
    await worker.stop().catch(() => undefined);
    await fakeOpenAI.close().catch(() => undefined);
    await fakeMcp.close().catch(() => undefined);
    if (fakeGemini !== undefined) {
      await fakeGemini.close().catch(() => undefined);
    }
    if (consoleServer) {
      await new Promise<void>((resolve) => {
        consoleServer!.close(() => resolve());
      });
    }
    await fs
      .rm(trustedRuntimeRoot, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
}

export async function consoleJson(
  stack: M12_3Stack,
  workspaceId: WorkspaceId,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; text: string; body: unknown }> {
  const response = await fetch(`${stack.consoleOrigin}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...stack.consoleHeaders(workspaceId),
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length === 0 ? null : (JSON.parse(text) as unknown);
  } catch {
    body = text;
  }
  return { status: response.status, text, body };
}

export function assertNoSentinelLeak(payload: string): void {
  if (payload.includes(SENTINEL_CREDENTIAL)) {
    throw new Error("Sentinel credential leaked in response payload");
  }
}

export async function waitForRunSucceeded(
  stack: M12_3Stack,
  workspaceId: WorkspaceId,
  runId: string,
): Promise<void> {
  await pollUntil({
    label: `run ${runId} succeeded`,
    deadlineMs: 120_000,
    probe: async () => {
      const run = await consoleJson(
        stack,
        workspaceId,
        `/api/v1/runs/${encodeURIComponent(runId)}`,
      );
      const status = (run.body as { status?: string } | null)?.status;
      if (status === "FAILED") {
        throw new Error(`Run ${runId} failed: ${run.text.slice(0, 500)}`);
      }
      return { done: status === "SUCCEEDED", lastState: status };
    },
  });
  const run = await consoleJson(
    stack,
    workspaceId,
    `/api/v1/runs/${encodeURIComponent(runId)}`,
  );
  if ((run.body as { status?: string }).status !== "SUCCEEDED") {
    throw new Error(`Run ${runId} did not succeed: ${run.text.slice(0, 500)}`);
  }
}
