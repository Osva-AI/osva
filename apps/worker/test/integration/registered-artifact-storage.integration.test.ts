import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  loadArtifactStorageConfig,
  resolveArtifactBlobStoreFromConfig,
} from "@osva/adapters-artifact-storage";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import type { WorkspaceId } from "@osva-ai/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startFakeRemoteRuntime } from "../../../../adapters/runtime-http/test/fake-remote-runtime.js";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import { createWebProcess } from "../../../web/src/process.js";
import { createWorkerProcess } from "../../src/process.js";
import {
  bootstrapIntegrationAuth,
  fetchJson,
  integrationAuthHeaders,
} from "./integration-auth.js";
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

const WORKSPACE_ID = "ws-registered-artifact" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");

const registeredFilesystemModuleUrl = pathToFileURL(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../adapters/artifact-storage/test/fixtures/registered-filesystem-blob-store.js",
  ),
).href;

function registeredArtifactEnv(
  artifactRoot: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    OSVA_ARTIFACT_STORAGE_DRIVER: "registered",
    OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE: registeredFilesystemModuleUrl,
    OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
    ...extra,
  };
}

describe("registered artifact storage cross-process", () => {
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
  });

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
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
  });

  it("worker writes through registered storage and web retrieves content", async () => {
    const artifactRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-registered-artifact-"),
    );
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-registered-artifact-runtime-"),
    );
    const storageEnv = registeredArtifactEnv(artifactRoot);
    const previousArtifactRoot = process.env.OSVA_ARTIFACT_FILESYSTEM_ROOT;
    process.env.OSVA_ARTIFACT_FILESYSTEM_ROOT = artifactRoot;
    const remote = await startFakeRemoteRuntime({ callArtifact: true });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        ...storageEnv,
      }),
    );
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OSVA_RUNTIME_CAPABILITY_SECRET: "capability-secret",
      OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true",
      ...storageEnv,
    });
    const inspector = new BullMqJobQueue({ url: valkey.url });
    const payload = "registered-artifact-cross-process";

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const created = await createRemoteRun(
        origin,
        `${remote.origin}/execute`,
        { content: payload },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      const artifactId = (
        (
          attempt.body as {
            output: { reference: { artifactId: string } };
          }
        ).output.reference as { artifactId: string }
      ).artifactId;

      const download = await fetch(
        `${origin}/v1/artifacts/${artifactId}/content`,
        { headers: integrationAuthHeaders() },
      );
      expect(download.status).toBe(200);
      expect(await download.text()).toBe(payload);
      expect(await inspector.countActiveJobs()).toBe(0);
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
      await remote.close();
      if (previousArtifactRoot === undefined) {
        delete process.env.OSVA_ARTIFACT_FILESYSTEM_ROOT;
      } else {
        process.env.OSVA_ARTIFACT_FILESYSTEM_ROOT = previousArtifactRoot;
      }
      await fs.rm(artifactRoot, { recursive: true, force: true });
      await fs.rm(trustedRuntimeRoot, { recursive: true, force: true });
    }
  });

  // Same rejection as web listen() for registered storage (see resolve in
  // apps/web/src/process.ts); unit coverage in registered-loader.test.ts.
  it("rejects invalid registered artifact module before web listen", async () => {
    const artifactRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-registered-artifact-invalid-"),
    );
    const invalidModuleUrl = pathToFileURL(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../adapters/artifact-storage/test/fixtures/registered-invalid-module.js",
      ),
    ).href;

    try {
      const config = loadArtifactStorageConfig({
        OSVA_ARTIFACT_STORAGE_DRIVER: "registered",
        OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE: invalidModuleUrl,
        OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
      });
      await expect(resolveArtifactBlobStoreFromConfig(config)).rejects.toThrow(
        /must export createArtifactBlobStore/,
      );
    } finally {
      await fs.rm(artifactRoot, { recursive: true, force: true });
    }
  });
});

async function createRemoteRun(
  origin: string,
  endpoint: string,
  input: unknown,
): Promise<{ readonly runId: string; readonly runAttemptId: string }> {
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      key: `registered-${String(Date.now())}-${Math.random()}`,
      name: "Registered Artifact Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "registered-artifact-agent",
        name: "Registered Artifact Agent",
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "1",
          endpoint,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 8_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
    },
  });
  expect(version.status).toBe(201);
  const created = await fetchJson(`${origin}/v1/runs`, {
    method: "POST",
    body: {
      agentId,
      agentVersionId: (version.body as { id: string }).id,
      input,
    },
  });
  expect(created.status).toBe(201);
  return {
    runId: (created.body as { run: { id: string } }).run.id,
    runAttemptId: (created.body as { runAttempt: { id: string } }).runAttempt
      .id,
  };
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error("Timed out waiting for registered artifact run.");
}
