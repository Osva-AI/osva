import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";

import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { startFakeHttpMcpServer } from "@osva/adapters-mcp-client/testing";
import type { WorkspaceId } from "@osva-ai/contracts";
import type { Database } from "@osva/db";
import { createDatabase } from "@osva/db";
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import { createWebProcess } from "../../../web/src/process.js";
import {
  createWorkerProcess,
  type WorkerProcessDependencies,
} from "../../../worker/src/process.js";
import { createConsoleServer } from "../../src/server/server.js";
import {
  allocateWebAndConsolePorts,
  loopbackOrigin,
} from "./allocate-loopback-port.js";
import { pollUntil } from "./poll-deadline.js";
import {
  bootstrapHumanOwner,
  bootstrapM12_3Workspaces,
  completeOwnerPassword,
  CookieJar,
  HUMAN_PASSWORD,
  OPERATOR_EMAIL,
  provisionOperator,
  SENTINEL_CREDENTIAL,
  type M12_3Stack,
} from "./m12-3-harness.js";
import { TEST_AUTH_SECRET } from "../../../../packages/db/test/integration/web-auth-env.js";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

const consoleClientDistDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/client",
);

export type M20_7StackProfile = "deterministic" | "live-ready";

export interface M20_7Stack extends Omit<M12_3Stack, "fakeOpenAI"> {
  readonly profile: M20_7StackProfile;
  readonly fakeOpenAI?: Awaited<
    ReturnType<typeof startFakeOpenAIResponsesServer>
  >;
  readonly forbiddenProviderOrigins: readonly string[];
}

async function activateOperatorViaConsoleBff(
  consoleOrigin: string,
  operatorSetupToken: string,
): Promise<CookieJar> {
  const jar = new CookieJar();
  const setup = await fetch(`${consoleOrigin}/api/v1/auth/setup/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: consoleOrigin },
    body: JSON.stringify({
      token: operatorSetupToken,
      password: HUMAN_PASSWORD,
    }),
  });
  jar.absorb(setup);
  if (setup.status !== 200) {
    throw new Error(`Operator setup failed: ${setup.status}`);
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

/**
 * Human console stack for M20.7. Deterministic profile keeps fake OpenAI for fixture routing.
 * Live-ready uses real provider credentials and does not start a fake OpenAI listener.
 */
export async function startM20_7HumanConsoleStack(options: {
  readonly database: Database;
  readonly databaseUrl: string;
  readonly valkeyUrl: string;
  readonly profile: M20_7StackProfile;
  readonly workerDependencies?: WorkerProcessDependencies;
}): Promise<M20_7Stack> {
  const { workspaceA, workspaceB } = await bootstrapM12_3Workspaces(
    options.database,
  );
  await bootstrapHumanOwner(options.database);

  const fakeOpenAI =
    options.profile === "deterministic"
      ? await startFakeOpenAIResponsesServer()
      : undefined;
  const forbiddenProviderOrigins =
    fakeOpenAI !== undefined ? [fakeOpenAI.origin.replace(/\/+$/, "")] : [];

  const fakeMcp = await startFakeHttpMcpServer();
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-m20-7-runtime-"),
  );

  const { webPort, consolePort } = await allocateWebAndConsolePorts();
  const consoleOrigin = loopbackOrigin(consolePort);
  const webOrigin = loopbackOrigin(webPort);

  const liveProvider = (process.env.OSVA_M20_7_LIVE_PROVIDER ?? "openai")
    .trim()
    .toLowerCase();
  const openAiKey =
    options.profile === "live-ready"
      ? process.env.OPENAI_API_KEY?.trim()
      : SENTINEL_CREDENTIAL;
  const geminiKey =
    options.profile === "live-ready"
      ? (process.env.GOOGLE_GEMINI_API_KEY?.trim() ??
        process.env.GEMINI_API_KEY?.trim())
      : undefined;
  const anthropicKey =
    options.profile === "live-ready"
      ? process.env.ANTHROPIC_API_KEY?.trim()
      : undefined;
  const geminiOnlyLiveReady =
    options.profile === "live-ready" &&
    liveProvider === "gemini" &&
    geminiKey !== undefined &&
    geminiKey.length > 0;
  const anthropicOnlyLiveReady =
    options.profile === "live-ready" &&
    liveProvider === "anthropic" &&
    anthropicKey !== undefined &&
    anthropicKey.length > 0;
  const connectionBoundProviderLiveReady =
    geminiOnlyLiveReady || anthropicOnlyLiveReady;

  if (options.profile === "live-ready") {
    if (connectionBoundProviderLiveReady) {
      // Legacy env OpenAI adapter is omitted; live smoke uses connection-bound provider only.
    } else {
      if (openAiKey === undefined || openAiKey.length === 0) {
        throw new Error("OPENAI_API_KEY required for live-ready stack.");
      }
      if (openAiKey === SENTINEL_CREDENTIAL) {
        throw new Error("SENTINEL_OPENAI_KEY_IN_LIVE_MODE");
      }
    }
    if (liveProvider === "anthropic" && !anthropicOnlyLiveReady) {
      throw new Error(
        "ANTHROPIC_API_KEY required for Anthropic live-ready stack.",
      );
    }
  }

  const providerKeyEnv = {
    ...(geminiKey !== undefined ? { GOOGLE_GEMINI_API_KEY: geminiKey } : {}),
    ...(anthropicKey !== undefined ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
    ...(connectionBoundProviderLiveReady
      ? {}
      : { OPENAI_API_KEY: openAiKey ?? SENTINEL_CREDENTIAL }),
  };

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
    ...providerKeyEnv,
  });

  const worker = createWorkerProcess(
    {
      OSVA_DATABASE_URL: options.databaseUrl,
      OSVA_VALKEY_URL: options.valkeyUrl,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
      ...providerKeyEnv,
    },
    (connectionString) => createDatabase({ connectionString, max: 5 }),
    options.workerDependencies,
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
      profile: options.profile,
      fakeOpenAI,
      forbiddenProviderOrigins,
      fakeMcp,
      consoleHeaders,
      copyAgentFixture,
      close: async () => {
        await web.stop();
        await worker.stop();
        if (fakeOpenAI !== undefined) {
          await fakeOpenAI.close();
        }
        await fakeMcp.close();
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
    if (fakeOpenAI !== undefined) {
      await fakeOpenAI.close().catch(() => undefined);
    }
    await fakeMcp.close().catch(() => undefined);
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
