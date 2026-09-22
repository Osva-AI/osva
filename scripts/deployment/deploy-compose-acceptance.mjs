#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { httpGetWithHost } from "./mcp-http-check.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const COMPOSE_DIR = path.join(REPO_ROOT, "deploy", "compose");

const REQUIRED_SERVICES = [
  "web",
  "worker",
  "scheduler",
  "workflow-orchestrator",
  "knowledge-worker",
  "mcp-server",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? COMPOSE_DIR,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout ?? "";
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? COMPOSE_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

async function waitHttp(url, attempts = 90) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function assertServicesRunning(password) {
  const output = runCapture("docker", ["compose", "ps", "--format", "json"], {
    env: { POSTGRES_PASSWORD: password },
  });
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const records = lines.map((line) => JSON.parse(line));
  for (const service of REQUIRED_SERVICES) {
    const match = records.find((record) => record.Service === service);
    if (!match) {
      throw new Error(`Compose service missing: ${service}`);
    }
    if (match.State !== "running") {
      throw new Error(
        `Compose service ${service} not running (state=${match.State})`,
      );
    }
  }
}

function assertStartupLogs(password) {
  const patterns = {
    worker: '"event":"worker.started"',
    scheduler: '"event":"scheduler.started"',
    "workflow-orchestrator": '"event":"workflow_orchestrator.started"',
    "knowledge-worker": '"event":"knowledge_worker.started"',
    "mcp-server": '"event":"mcp_server.started"',
  };
  for (const [service, pattern] of Object.entries(patterns)) {
    const logs = runCapture("docker", ["compose", "logs", service], {
      env: { POSTGRES_PASSWORD: password },
    });
    if (!logs.includes(pattern)) {
      throw new Error(
        `Expected startup log for ${service} (${pattern}) was not found.`,
      );
    }
  }
}

async function assertMcpHostBehavior(mcpPort) {
  const healthEvil = await httpGetWithHost(
    mcpPort,
    "evil.example.com",
    "/health",
  );
  if (healthEvil !== 200) {
    throw new Error("MCP /health should ignore Host header validation.");
  }

  const mcpRejected = await httpGetWithHost(
    mcpPort,
    "evil.example.com",
    "/mcp",
  );
  if (mcpRejected !== 403) {
    throw new Error(
      `Expected MCP /mcp to reject evil host with 403, got ${String(mcpRejected)}`,
    );
  }

  const mcpLocalhost = await httpGetWithHost(mcpPort, "127.0.0.1", "/mcp");
  if (mcpLocalhost === 403) {
    throw new Error("MCP /mcp should allow localhost Host by default.");
  }
}

async function fetchWithRetry(url, options, attempts = 10) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError;
}

async function main() {
  const password =
    process.env.POSTGRES_PASSWORD ?? "compose-acceptance-password";
  const webPort = process.env.OSVA_PUBLISH_WEB_PORT ?? "18080";
  const mcpPort = Number.parseInt(
    process.env.OSVA_PUBLISH_MCP_PORT ?? "13100",
    10,
  );
  const composeEnv = {
    POSTGRES_PASSWORD: password,
    OSVA_PUBLISH_WEB_PORT: webPort,
    OSVA_PUBLISH_MCP_PORT: String(mcpPort),
  };

  const tearDown = () => {
    try {
      run("docker", ["compose", "down", "-v"], { env: composeEnv });
    } catch {
      // best effort
    }
  };

  run("docker", ["compose", "down", "-v"], { env: composeEnv });
  run("docker", ["compose", "up", "-d", "--build", "--wait"], {
    env: composeEnv,
  });

  runCapture(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_isready",
      "-U",
      "osva",
      "-d",
      "osva",
    ],
    {
      env: composeEnv,
    },
  );
  const valkeyPing = runCapture(
    "docker",
    ["compose", "exec", "-T", "valkey", "valkey-cli", "ping"],
    { env: composeEnv },
  );
  if (!valkeyPing.includes("PONG")) {
    throw new Error("Valkey did not respond to PING.");
  }

  assertServicesRunning(password);
  assertStartupLogs(password);

  await waitHttp(`http://127.0.0.1:${webPort}/health`);
  await waitHttp(`http://127.0.0.1:${webPort}/ready`);
  await waitHttp(`http://127.0.0.1:${mcpPort}/health`);
  await assertMcpHostBehavior(mcpPort);

  const bootstrap = spawnSync(
    "docker",
    ["compose", "--profile", "bootstrap", "run", "--rm", "bootstrap"],
    {
      cwd: COMPOSE_DIR,
      encoding: "utf8",
      env: { ...process.env, ...composeEnv },
    },
  );
  if (bootstrap.status !== 0) {
    throw new Error(bootstrap.stderr || bootstrap.stdout);
  }

  const tokenMatch = bootstrap.stdout.match(
    /osva_ak_[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+/,
  );
  if (!tokenMatch) {
    throw new Error("Bootstrap did not print an API key token");
  }
  const token = tokenMatch[0];

  const apiResponse = await fetchWithRetry(
    `http://127.0.0.1:${webPort}/v1/api-keys`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!apiResponse.ok) {
    throw new Error(
      `Authenticated /v1/api-keys returned ${apiResponse.status}`,
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));
  assertServicesRunning(password);

  run("docker", ["compose", "down", "-v"], { env: composeEnv });
  console.log("deploy compose acceptance PASS");
}

main().catch((error) => {
  console.error(error);
  try {
    const password =
      process.env.POSTGRES_PASSWORD ?? "compose-acceptance-password";
    run("docker", ["compose", "down", "-v"], {
      env: {
        POSTGRES_PASSWORD: password,
        OSVA_PUBLISH_WEB_PORT: process.env.OSVA_PUBLISH_WEB_PORT ?? "18080",
        OSVA_PUBLISH_MCP_PORT: process.env.OSVA_PUBLISH_MCP_PORT ?? "13100",
      },
    });
  } catch {
    // ignore teardown errors
  }
  process.exitCode = 1;
});
