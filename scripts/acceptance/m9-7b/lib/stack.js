import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnProcess } from "./docker.js";
import { waitUntil, withTimeout } from "./timeouts.js";
import { RUN_COMPLETE_TIMEOUT_MS } from "./constants.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const ECHO_AGENT_SOURCE = path.join(
  REPO_ROOT,
  "adapters/runtime-typescript/test/fixtures/echo-input-agent.ts",
);
const SLOW_HOLD_AGENT_SOURCE = path.join(
  REPO_ROOT,
  "adapters/runtime-typescript/test/fixtures/slow-hold-agent.ts",
);
const ARTIFACT_ECHO_AGENT_SOURCE = path.join(
  REPO_ROOT,
  "adapters/runtime-typescript/test/fixtures/artifact-echo-agent.ts",
);

export function resolveValkeyUrl(infra) {
  return infra.valkey.stableUrl ?? infra.valkey.url;
}

export async function ensureBuildArtifacts() {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@osva/web",
      "--filter=@osva/worker",
      "--filter=@osva/db",
      "--filter=@osva/adapters-bullmq",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error("Failed to build web/worker/db artifacts for acceptance.");
  }
}

export async function createStackPaths(runId) {
  const artifactRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `osva-m97b-artifacts-${runId.slice(0, 8)}-`),
  );
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `osva-m97b-trusted-${runId.slice(0, 8)}-`),
  );
  await fs.copyFile(
    ECHO_AGENT_SOURCE,
    path.join(trustedRuntimeRoot, "echo-input-agent.ts"),
  );
  const integrityHex = createHash("sha256")
    .update(
      await fs.readFile(path.join(trustedRuntimeRoot, "echo-input-agent.ts")),
    )
    .digest("hex");
  const integrity = `sha256:${integrityHex}`;
  return { artifactRoot, trustedRuntimeRoot, integrity };
}

export function startWebWorkerProcesses(
  infra,
  paths,
  webPort = "0",
  extraEnv = {},
) {
  const env = {
    OSVA_DATABASE_URL: infra.postgres.connectionString,
    OSVA_VALKEY_URL: resolveValkeyUrl(infra),
    OSVA_WEB_HOST: "127.0.0.1",
    OSVA_WEB_PORT: webPort,
    OSVA_ARTIFACT_STORAGE_DRIVER: "filesystem",
    OSVA_ARTIFACT_FILESYSTEM_ROOT: paths.artifactRoot,
    OSVA_TRUSTED_RUNTIME_ROOT: paths.trustedRuntimeRoot,
    OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
    OSVA_KNOWLEDGE_EMBEDDING_MODEL: "deterministic-v1",
    OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS: "384",
    OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
    OSVA_HEALTH_PORT: "0",
    ...extraEnv,
  };

  const web = spawnProcess(
    process.execPath,
    [path.join(REPO_ROOT, "apps/web/dist/main.js")],
    { env, cwd: REPO_ROOT },
  );
  const worker = spawnProcess(
    process.execPath,
    [path.join(REPO_ROOT, "apps/worker/dist/main.js")],
    { env, cwd: REPO_ROOT },
  );

  return { web, worker, env };
}

export function startWebProcessOnly(
  infra,
  paths,
  webPort = "0",
  extraEnv = {},
) {
  const env = {
    OSVA_DATABASE_URL: infra.postgres.connectionString,
    OSVA_VALKEY_URL: resolveValkeyUrl(infra),
    OSVA_WEB_HOST: "127.0.0.1",
    OSVA_WEB_PORT: webPort,
    OSVA_ARTIFACT_STORAGE_DRIVER: "filesystem",
    OSVA_ARTIFACT_FILESYSTEM_ROOT: paths.artifactRoot,
    OSVA_TRUSTED_RUNTIME_ROOT: paths.trustedRuntimeRoot,
    OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
    OSVA_KNOWLEDGE_EMBEDDING_MODEL: "deterministic-v1",
    OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS: "384",
    OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
    OSVA_HEALTH_PORT: "0",
    ...extraEnv,
  };
  const web = spawnProcess(
    process.execPath,
    [path.join(REPO_ROOT, "apps/web/dist/main.js")],
    { env, cwd: REPO_ROOT },
  );
  return { web, env };
}

export function startWorkerProcess(infra, paths, label = "worker") {
  const env = {
    OSVA_DATABASE_URL: infra.postgres.connectionString,
    OSVA_VALKEY_URL: resolveValkeyUrl(infra),
    OSVA_ARTIFACT_STORAGE_DRIVER: "filesystem",
    OSVA_ARTIFACT_FILESYSTEM_ROOT: paths.artifactRoot,
    OSVA_TRUSTED_RUNTIME_ROOT: paths.trustedRuntimeRoot,
    OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
    OSVA_KNOWLEDGE_EMBEDDING_MODEL: "deterministic-v1",
    OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS: "384",
    OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
    OSVA_HEALTH_PORT: "0",
    OSVA_EXECUTION_RECOVERY_POLL_MS: "500",
  };
  const worker = spawnProcess(
    process.execPath,
    [path.join(REPO_ROOT, "apps/worker/dist/main.js")],
    { env, cwd: REPO_ROOT },
  );
  return { worker, env, label };
}

export async function createStackPathsWithFixture(
  runId,
  fixtureFileName,
  fixtureSourcePath,
) {
  const artifactRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `osva-m97b-artifacts-${runId.slice(0, 8)}-`),
  );
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `osva-m97b-trusted-${runId.slice(0, 8)}-`),
  );
  const dest = path.join(trustedRuntimeRoot, fixtureFileName);
  await fs.copyFile(fixtureSourcePath, dest);
  const integrityHex = createHash("sha256")
    .update(await fs.readFile(dest))
    .digest("hex");
  return {
    artifactRoot,
    trustedRuntimeRoot,
    integrity: `sha256:${integrityHex}`,
    fixtureEntrypoint: fixtureFileName,
  };
}

export async function forceKillProcess(child, label) {
  if (isChildStopped(child)) {
    return;
  }
  const { spawnSync } = await import("node:child_process");
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGKILL");
  }
  await waitUntil(() => isChildStopped(child), {
    timeoutMs: 15_000,
    message: `${label} did not exit after SIGKILL`,
  });
}

export async function waitForHttpOk(url, timeoutMs = 60_000) {
  await waitUntil(
    async () => {
      try {
        const response = await fetch(url);
        return response.ok;
      } catch {
        return false;
      }
    },
    { timeoutMs, message: `HTTP not ready: ${url}` },
  );
}

export async function bootstrapApiKey(connectionString) {
  const { spawnSync } = await import("node:child_process");
  const workspaceId = randomUUID();
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, "packages/db/dist/bootstrap-cli.js"),
      connectionString,
      `--workspace-id=${workspaceId}`,
      "--workspace-name=Acceptance Workspace",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, OSVA_DATABASE_URL: connectionString },
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "bootstrap failed");
  }
  const match = `${result.stdout}\n${result.stderr}`.match(
    /osva_ak_[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+/,
  );
  if (!match) {
    throw new Error("Bootstrap did not emit an API key token");
  }
  return { token: match[0], workspaceId };
}

export async function runEchoAgentFlow(origin, token, integrity, options = {}) {
  const marker = options.marker ?? "m9-7b";
  const agentKey = options.agentKey ?? "echo-agent";
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const agent = await fetchJson(`${origin}/v1/agents`, headers, {
    method: "POST",
    body: JSON.stringify({ key: agentKey, name: "Echo Agent" }),
  });
  if (agent.status !== 201) {
    throw new Error(`Create agent failed: ${agent.status}`);
  }
  const agentId = agent.body.id;

  const version = await fetchJson(
    `${origin}/v1/agents/${agentId}/versions`,
    headers,
    {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          schemaVersion: "1",
          key: agentKey,
          name: "Echo Agent",
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "echo-input-agent.ts",
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 30_000, maxAttempts: 1 },
          capabilities: { model: false, tools: [] },
        },
      }),
    },
  );
  if (version.status !== 201) {
    throw new Error(
      `Create agent version failed: ${version.status} ${JSON.stringify(version.body)}`,
    );
  }
  const agentVersionId = version.body.id;

  const run = await fetchJson(`${origin}/v1/runs`, headers, {
    method: "POST",
    body: JSON.stringify({
      agentId,
      agentVersionId,
      input: { acceptance: true, marker },
    }),
  });
  if (run.status !== 201) {
    throw new Error(`Create run failed: ${run.status}`);
  }

  const runId = run.body.run.id;
  const runAttemptId = run.body.runAttempt.id;

  await withTimeout(
    waitUntil(
      async () => {
        const attempt = await fetchJson(
          `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
          headers,
        );
        return attempt.body.status === "SUCCEEDED";
      },
      {
        timeoutMs: RUN_COMPLETE_TIMEOUT_MS,
        message: "RunAttempt did not succeed",
      },
    ),
    RUN_COMPLETE_TIMEOUT_MS + 5_000,
    "run completion",
  );

  const attempt = await fetchJson(
    `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
    headers,
  );

  return { runId, runAttemptId, attempt: attempt.body };
}

export async function startAgentRun(origin, token, integrity, options = {}) {
  const marker = options.marker ?? "m9-7b";
  const agentKey = options.agentKey ?? "acceptance-agent";
  const entrypoint = options.entrypoint ?? "echo-input-agent.ts";
  const timeoutMs = options.executionTimeoutMs ?? 30_000;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const agent = await fetchJson(`${origin}/v1/agents`, headers, {
    method: "POST",
    body: JSON.stringify({ key: agentKey, name: "Acceptance Agent" }),
  });
  if (agent.status !== 201) {
    throw new Error(`Create agent failed: ${agent.status}`);
  }
  const agentId = agent.body.id;

  const version = await fetchJson(
    `${origin}/v1/agents/${agentId}/versions`,
    headers,
    {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          schemaVersion: "1",
          key: agentKey,
          name: "Acceptance Agent",
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint,
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs, maxAttempts: 1 },
          capabilities: { model: false, tools: [] },
        },
      }),
    },
  );
  if (version.status !== 201) {
    throw new Error(
      `Create agent version failed: ${version.status} ${JSON.stringify(version.body)}`,
    );
  }
  const agentVersionId = version.body.id;

  const run = await fetchJson(`${origin}/v1/runs`, headers, {
    method: "POST",
    body: JSON.stringify({
      agentId,
      agentVersionId,
      input: { acceptance: true, marker },
    }),
  });
  if (run.status !== 201) {
    throw new Error(`Create run failed: ${run.status}`);
  }

  return {
    runId: run.body.run.id,
    runAttemptId: run.body.runAttempt.id,
    agentId,
    agentVersionId,
  };
}

export async function waitForRunAttemptStatus(
  origin,
  token,
  runId,
  runAttemptId,
  expectedStatus,
  timeoutMs = RUN_COMPLETE_TIMEOUT_MS,
) {
  const headers = { authorization: `Bearer ${token}` };
  let last;
  await withTimeout(
    waitUntil(
      async () => {
        const attempt = await fetchJson(
          `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
          headers,
        );
        last = attempt.body;
        return attempt.body.status === expectedStatus;
      },
      {
        timeoutMs,
        message: `RunAttempt did not reach ${expectedStatus}`,
      },
    ),
    timeoutMs + 5_000,
    "run attempt status wait",
  );
  return last;
}

async function fetchJson(url, headers, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
    body: init.body,
  });
  const body = await response.json();
  return { status: response.status, body };
}

function isChildStopped(child) {
  if (child.exitCode !== null || child.killed) {
    return true;
  }
  if (!child.pid) {
    return true;
  }
  try {
    process.kill(child.pid, 0);
    return false;
  } catch {
    return true;
  }
}

export async function stopProcessGracefully(child, label, timeoutMs = 20_000) {
  if (isChildStopped(child)) {
    return;
  }
  const { spawnSync } = await import("node:child_process");

  child.kill("SIGTERM");
  try {
    await waitUntil(() => isChildStopped(child), {
      timeoutMs,
      message: `${label} did not exit after SIGTERM`,
    });
    return;
  } catch {
    // fall through to forceful shutdown
  }

  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGKILL");
  }

  await waitUntil(() => isChildStopped(child), {
    timeoutMs: 10_000,
    message: `${label} did not exit after forced shutdown`,
  });
}

export function getRepoRoot() {
  return REPO_ROOT;
}

export function describeProcessState(child, label) {
  return {
    label,
    pid: child.pid ?? null,
    exitCode: child.exitCode,
    stopped: isChildStopped(child),
  };
}

export async function probeHttpJson(url) {
  const started = Date.now();
  try {
    const response = await fetch(url);
    let body;
    try {
      body = await response.json();
    } catch {
      body = { parseError: true };
    }
    return {
      url,
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - started,
      body,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function pollReadyRecovery(origin, timeoutMs) {
  const pollStarted = Date.now();
  const deadline = pollStarted + timeoutMs;
  const samples = [];
  while (Date.now() < deadline) {
    const sample = await probeHttpJson(`${origin}/ready`);
    samples.push({ at: new Date().toISOString(), ...sample });
    if (sample.ok) {
      return {
        recovered: true,
        msToReady: Date.now() - pollStarted,
        samples,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    recovered: false,
    msToReady: undefined,
    samples,
  };
}
