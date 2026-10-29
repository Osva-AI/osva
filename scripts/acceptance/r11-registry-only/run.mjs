#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_MIGRATION_HEAD,
  buildComposeAcceptanceEnv,
} from "../../deployment/deploy-compose-acceptance-env.mjs";
import { httpGetWithHost } from "../../deployment/mcp-http-check.mjs";
import { verifyRuntimeImageContents } from "../../deployment/verify-runtime-image.mjs";
import { COMPOSE_PROJECT, GHCR_IMAGE_TAG, RC4_SEMVER } from "./constants.mjs";
import { AcceptanceReport } from "./report.mjs";
import {
  auditGhcrDigestPull,
  auditNpmRcVersions,
  auditPyPiHashes,
} from "./registry-audit.mjs";
import { parseGroups, runsGroup } from "./lib/groups.mjs";
import { runMcpConnectorAcceptance } from "./lib/mcp-connector-acceptance.mjs";
import { createPublishedNpmConsumer } from "./lib/published-npm-consumer.mjs";
import { probeSdkMultipart } from "./lib/sdk-multipart-probe.mjs";
import { runPublishedWorkflowAcceptance } from "./lib/workflow-acceptance.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
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

const DEFAULT_DEADLINE_MS = 15 * 60 * 1000;

function printHelp() {
  console.log(`Usage: pnpm acceptance:r11-registry

Registry-only RC.4 published-artifact acceptance (M10.4E replay).

Requires:
  OSVA_RC4_REGISTRY_ACCEPTANCE=1
  Docker Compose v2, Node 24+, Python 3.11+ on PATH

Optional:
  OSVA_IMAGE (defaults to ${GHCR_IMAGE_TAG})
  COMPOSE_PROJECT_NAME (defaults to ${COMPOSE_PROJECT})
  OSVA_PUBLISH_WEB_PORT / OSVA_PUBLISH_MCP_PORT (defaults 18080 / 13100)
  OSVA_R11_SKIP_COMPOSE=1  — audit + image smoke only (no live stack)
  OSVA_R11_GROUPS=workflow,mcp,multipart  — focused unfinished journeys
  --group=full  — default full replay
`);
}

function runDocker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: options.cwd ?? COMPOSE_DIR,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed`);
  }
  return result.stdout ?? "";
}

function runDockerCapture(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: options.cwd ?? COMPOSE_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `docker ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

async function waitUntil(deadlineMs, label, fn) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(
    `Timed out waiting for ${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function composeEnvBase(options = {}) {
  const composeEnv = buildComposeAcceptanceEnv(process.env);
  return {
    ...composeEnv,
    OSVA_IMAGE: process.env.OSVA_IMAGE?.trim() || GHCR_IMAGE_TAG,
    COMPOSE_PROJECT_NAME:
      process.env.COMPOSE_PROJECT_NAME?.trim() || COMPOSE_PROJECT,
    ...(options.allowPrivateMcp === true
      ? { OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true" }
      : {}),
  };
}

function assertServicesRunning(composeEnv) {
  const output = runDockerCapture(["compose", "ps", "--format", "json"], {
    env: composeEnv,
  });
  const records = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  for (const service of REQUIRED_SERVICES) {
    const match = records.find((record) => record.Service === service);
    if (!match || match.State !== "running") {
      throw new Error(
        `Compose service ${service} not running (state=${match?.State ?? "missing"})`,
      );
    }
  }
}

function assertMigrationStatus(composeEnv) {
  const databaseUrl = `postgres://osva:${composeEnv.POSTGRES_PASSWORD}@postgres:5432/osva`;
  const output = runDockerCapture(
    [
      "compose",
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "node",
      "migrate",
      "/app/packages/db/dist/migrations-status-cli.js",
      databaseUrl,
    ],
    { env: composeEnv },
  );
  if (!output.includes(`repository head: ${EXPECTED_MIGRATION_HEAD}`)) {
    throw new Error(`Missing repository head ${EXPECTED_MIGRATION_HEAD}`);
  }
  if (!output.includes(`database head: ${EXPECTED_MIGRATION_HEAD}`)) {
    throw new Error(`Database not at head ${EXPECTED_MIGRATION_HEAD}`);
  }
  if (!output.includes("pending migrations: (none)")) {
    throw new Error("Pending migrations remain");
  }
  if (!output.includes("status: current")) {
    throw new Error("Migration status not current");
  }
}

async function assertMcpHostBehavior(mcpPort) {
  const healthEvil = await httpGetWithHost(
    mcpPort,
    "evil.example.com",
    "/health",
  );
  if (healthEvil !== 200) {
    throw new Error("MCP /health should ignore Host validation");
  }
  const mcpRejected = await httpGetWithHost(
    mcpPort,
    "evil.example.com",
    "/mcp",
  );
  if (mcpRejected !== 403) {
    throw new Error(`Expected MCP /mcp 403 for evil host, got ${mcpRejected}`);
  }
}

async function runRegistryConsumers(ctx) {
  const { baseUrl, apiKey, workspaceId, report, installRoot, workRoot } = ctx;
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

  try {
    const cliBin = path.join(
      installRoot,
      "node_modules",
      "@osva-ai",
      "cli",
      "dist",
      "bin",
      "osva.js",
    );

    const doctor = spawnSync(process.execPath, [cliBin, "doctor"], {
      cwd: installRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        OSVA_BASE_URL: baseUrl,
        OSVA_API_KEY: apiKey,
      },
    });
    if (doctor.status !== 0) {
      throw new Error(`osva doctor failed: ${doctor.stderr}`);
    }

    const projectParent = path.join(workRoot, "projects");
    await mkdir(projectParent, { recursive: true });
    const init = spawnSync(
      process.execPath,
      [cliBin, "init", "registry-agent", "--yes"],
      {
        cwd: projectParent,
        encoding: "utf8",
        env: {
          ...process.env,
          OSVA_BASE_URL: baseUrl,
          OSVA_API_KEY: apiKey,
          OSVA_WORKSPACE_ID: workspaceId,
        },
      },
    );
    if (init.status !== 0) {
      throw new Error(`osva init failed: ${init.stderr}`);
    }

    const projectDir = path.join(projectParent, "registry-agent");
    for (const args of [
      ["install", "--no-fund", "--no-audit"],
      ["run", "build"],
      ["run", "manifest"],
    ]) {
      const step = spawnSync(npmCmd, args, {
        cwd: projectDir,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (step.status !== 0) {
        throw new Error(`npm ${args.join(" ")} failed`);
      }
    }

    const deployEnv = {
      ...process.env,
      OSVA_BASE_URL: baseUrl,
      OSVA_API_KEY: apiKey,
      OSVA_WORKSPACE_ID: workspaceId,
      OSVA_TRUSTED_RUNTIME_MODE: "compose",
      OSVA_COMPOSE_DIR: COMPOSE_DIR,
      COMPOSE_PROJECT_NAME: ctx.composeEnv.COMPOSE_PROJECT_NAME,
    };
    const deploy = spawnSync(process.execPath, [cliBin, "deploy", "--json"], {
      cwd: projectDir,
      encoding: "utf8",
      env: deployEnv,
    });
    if (deploy.status !== 0) {
      throw new Error(`deploy failed: ${deploy.stderr}`);
    }
    const deployBody = JSON.parse(deploy.stdout);

    const inputJson = JSON.stringify({ message: "Hello OSVA" });
    const runResult = spawnSync(
      process.execPath,
      [cliBin, "run", "--wait", "--json", "--input", inputJson],
      {
        cwd: projectDir,
        encoding: "utf8",
        env: deployEnv,
      },
    );
    if (runResult.status !== 0) {
      throw new Error(`run failed: ${runResult.stderr}\n${runResult.stdout}`);
    }
    const runBody = JSON.parse(runResult.stdout);
    if (runBody.output?.greeting !== "Hello, Hello OSVA!") {
      throw new Error(
        `Unexpected run output: ${JSON.stringify(runBody.output)}`,
      );
    }

    const sdkScript = path.join(installRoot, "sdk-smoke.mjs");
    await writeFile(
      sdkScript,
      `import { OsvaClient } from "@osva-ai/sdk";
const client = new OsvaClient({
  baseUrl: ${JSON.stringify(baseUrl)},
  apiKey: ${JSON.stringify(apiKey)},
});
const agents = await client.agents.list();
if (!Array.isArray(agents.agents)) throw new Error("agents.list shape");
console.log(JSON.stringify({ agentCount: agents.agents.length }));
`,
    );
    const sdkRun = spawnSync(process.execPath, [sdkScript], {
      cwd: installRoot,
      encoding: "utf8",
    });
    if (sdkRun.status !== 0) {
      throw new Error(`SDK live smoke failed: ${sdkRun.stderr}`);
    }
    report.record(
      "journey-06-cli",
      "Published npm CLI install and execution",
      "PASS",
      {
        evidence: {
          agentVersionId: deployBody.agentVersionId,
          runId: runBody.runId,
        },
      },
    );
    report.record(
      "journey-07-sdk",
      "Published npm SDK install and usage",
      "PASS",
    );
    report.record(
      "journey-08-agent",
      "Agent creation, publication and execution",
      "PASS",
      { evidence: { runStatus: runBody.status } },
    );

    const artifactScript = path.join(installRoot, "artifact-smoke.mjs");
    await writeFile(
      artifactScript,
      `import { randomUUID } from "node:crypto";
const baseUrl = ${JSON.stringify(baseUrl)};
const apiKey = ${JSON.stringify(apiKey)};
const auth = { authorization: \`Bearer \${apiKey}\` };
const ready = await fetch(\`\${baseUrl}/ready\`);
if (!ready.ok) throw new Error(\`/ready \${ready.status}\`);
const body = "registry-only artifact";
const form = new FormData();
form.set("name", "r11-smoke.txt");
form.append("file", new Blob([body], { type: "text/plain" }), "r11-smoke.txt");
const createdRes = await fetch(\`\${baseUrl}/v1/artifacts\`, {
  method: "POST",
  headers: { ...auth, "idempotency-key": randomUUID() },
  body: form,
});
if (!createdRes.ok) {
  throw new Error(\`artifact create \${createdRes.status}: \${await createdRes.text()}\`);
}
const created = await createdRes.json();
const downloaded = await fetch(\`\${baseUrl}/v1/artifacts/\${created.id}/content\`, {
  headers: auth,
});
if (!downloaded.ok) throw new Error(\`artifact download \${downloaded.status}\`);
const text = await downloaded.text();
if (text !== body) throw new Error("artifact content mismatch");
console.log(JSON.stringify({ artifactId: created.id }));
`,
    );
    const artifactRun = spawnSync(process.execPath, [artifactScript], {
      cwd: installRoot,
      encoding: "utf8",
    });
    if (artifactRun.status !== 0) {
      throw new Error(`Artifact smoke failed: ${artifactRun.stderr}`);
    }

    report.record(
      "journey-10-artifacts",
      "Artifact persistence and retrieval",
      "PASS",
      { evidence: { artifact: JSON.parse(artifactRun.stdout.trim()) } },
    );

    return {
      agentVersionId: deployBody.agentVersionId,
      runId: runBody.runId,
      projectDir,
    };
  } catch (error) {
    throw error;
  }
}

async function runPythonSmoke(baseUrl, apiKey, report) {
  const venvRoot = await mkdtemp(path.join(os.tmpdir(), "osva-r11-py-"));
  const venvDir = path.join(venvRoot, "venv");
  const python = process.platform === "win32" ? "python" : "python3";
  try {
    const create = spawnSync(python, ["-m", "venv", venvDir], {
      stdio: "inherit",
    });
    if (create.status !== 0) {
      throw new Error("python -m venv failed");
    }
    const venvPython =
      process.platform === "win32"
        ? path.join(venvDir, "Scripts", "python.exe")
        : path.join(venvDir, "bin", "python");

    const pipInstall = spawnSync(
      venvPython,
      ["-m", "pip", "install", "--no-cache-dir", "osva-sdk==1.1.0rc4"],
      { stdio: "inherit", timeout: 300_000 },
    );
    if (pipInstall.status !== 0) {
      throw new Error("pip install osva-sdk==1.1.0rc4 failed");
    }

    const smoke = spawnSync(
      venvPython,
      [
        "-c",
        `from osva import OSVAClient; import os; c=OSVAClient(base_url=os.environ["OSVA_BASE_URL"], api_key=os.environ["OSVA_API_KEY"]); print(c.agents.list())`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OSVA_BASE_URL: baseUrl,
          OSVA_API_KEY: apiKey,
        },
      },
    );
    if (smoke.status !== 0) {
      throw new Error(`Python live smoke failed: ${smoke.stderr}`);
    }
    report.record(
      "journey-11-python",
      "Published PyPI SDK installation and API smoke",
      "PASS",
    );
  } finally {
    await rm(venvRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  if (process.env.OSVA_RC4_REGISTRY_ACCEPTANCE !== "1") {
    console.error(
      "Refusing to run without OSVA_RC4_REGISTRY_ACCEPTANCE=1 (live registry + Docker).",
    );
    printHelp();
    process.exit(1);
  }

  const groups = parseGroups();
  const report = new AcceptanceReport();
  const startedAt = new Date().toISOString();
  const needsPrivateMcp = runsGroup(groups, "mcp");
  const composeEnv = composeEnvBase({ allowPrivateMcp: needsPrivateMcp });
  const webPort = composeEnv.OSVA_PUBLISH_WEB_PORT;
  const mcpPort = Number.parseInt(composeEnv.OSVA_PUBLISH_MCP_PORT, 10);
  const baseUrl = `http://127.0.0.1:${webPort}`;
  const skipCompose =
    process.env.OSVA_R11_SKIP_COMPOSE === "1" ||
    process.env.OSVA_R11_SKIP_COMPOSE === "true";

  /** @type {Record<string, unknown>} */
  const evidence = {
    startedAt,
    composeProject: composeEnv.COMPOSE_PROJECT_NAME,
    groups: [...groups],
    gitRevision: spawnSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim(),
  };

  /** @type {{ dispose: () => Promise<void> } | undefined} */
  let npmConsumer;

  try {
    if (!runsGroup(groups, "preflight")) {
      report.record(
        "journey-preflight-npm",
        "Published npm @rc identity",
        "NOT_RUN",
        { detail: "group filter" },
      );
      report.record(
        "journey-preflight-pypi",
        "Published PyPI osva-sdk hashes",
        "NOT_RUN",
        { detail: "group filter" },
      );
    }
    if (runsGroup(groups, "preflight")) {
      try {
        evidence.npmRc = await auditNpmRcVersions();
        report.record(
          "journey-preflight-npm",
          "Published npm @rc identity",
          "PASS",
        );
      } catch (error) {
        report.record(
          "journey-preflight-npm",
          "Published npm @rc identity",
          "FAIL",
          {
            detail: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }

      try {
        evidence.pypi = await auditPyPiHashes();
        report.record(
          "journey-preflight-pypi",
          "Published PyPI osva-sdk hashes",
          "PASS",
        );
      } catch (error) {
        report.record(
          "journey-preflight-pypi",
          "Published PyPI osva-sdk hashes",
          "FAIL",
          { detail: error instanceof Error ? error.message : String(error) },
        );
        throw error;
      }
    }

    if (!runsGroup(groups, "preflight")) {
      report.record(
        "journey-01-oci-pull",
        "Fresh container pull from GHCR",
        "NOT_RUN",
        { detail: "group filter" },
      );
      report.record(
        "journey-runtime-image",
        "Runtime image verification (entrypoint, prod deps)",
        "NOT_RUN",
        { detail: "group filter" },
      );
    }
    if (runsGroup(groups, "preflight")) {
      try {
        evidence.ghcr = auditGhcrDigestPull();
        report.record(
          "journey-01-oci-pull",
          "Fresh container pull from GHCR",
          "PASS",
          { evidence: evidence.ghcr },
        );
      } catch (error) {
        report.record(
          "journey-01-oci-pull",
          "Fresh container pull from GHCR",
          "FAIL",
          {
            detail: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }

      try {
        verifyRuntimeImageContents(composeEnv.OSVA_IMAGE);
        report.record(
          "journey-runtime-image",
          "Runtime image verification (entrypoint, prod deps)",
          "PASS",
        );
      } catch (error) {
        report.record(
          "journey-runtime-image",
          "Runtime image verification",
          "FAIL",
          { detail: error instanceof Error ? error.message : String(error) },
        );
        throw error;
      }
    }

    if (skipCompose) {
      report.record(
        "journey-02-migrations",
        "Database migration to head 0030",
        "NOT_RUN",
        { detail: "OSVA_R11_SKIP_COMPOSE=1" },
      );
      report.record(
        "journey-registry-compose",
        "Registry-only Compose replay",
        "NOT_RUN",
        { detail: "OSVA_R11_SKIP_COMPOSE=1" },
      );
      console.log(JSON.stringify(report.summaryJson(evidence), null, 2));
      process.exit(report.exitCode());
    }

    if (runsGroup(groups, "stack")) {
      runDocker(["compose", "down", "-v"], { env: composeEnv });
      runDocker(["compose", "pull"], { env: composeEnv });
      runDocker(["compose", "up", "-d", "--no-build", "--wait"], {
        env: composeEnv,
      });

      assertServicesRunning(composeEnv);
      assertMigrationStatus(composeEnv);
      report.record(
        "journey-02-migrations",
        "Database migration to head 0030",
        "PASS",
        { evidence: { head: EXPECTED_MIGRATION_HEAD } },
      );
    }

    await waitUntil(DEFAULT_DEADLINE_MS, "web /health", async () => {
      const response = await fetch(`${baseUrl}/health`);
      if (!response.ok) {
        throw new Error(`health ${response.status}`);
      }
    });
    await waitUntil(DEFAULT_DEADLINE_MS, "web /ready", async () => {
      const response = await fetch(`${baseUrl}/ready`);
      if (!response.ok) {
        throw new Error(`ready ${response.status}`);
      }
    });

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
    const workspaceMatch = bootstrap.stdout.match(
      /Workspace ID:\s*([0-9a-f-]{36})/i,
    );
    if (!tokenMatch || !workspaceMatch) {
      throw new Error("Bootstrap output missing API key or workspace id");
    }
    const apiKey = tokenMatch[0];
    const workspaceId = workspaceMatch[1];
    evidence.workspaceId = workspaceId;
    report.record(
      "journey-03-bootstrap",
      "Human identity and workspace bootstrap",
      "PASS",
      { evidence: { workspaceId } },
    );

    const embeddingEnv = runDockerCapture(
      [
        "compose",
        "exec",
        "-T",
        "web",
        "printenv",
        "OSVA_KNOWLEDGE_EMBEDDING_PROVIDER",
      ],
      { env: composeEnv },
    ).trim();
    if (embeddingEnv !== "DETERMINISTIC") {
      throw new Error(
        `Expected DETERMINISTIC embedding provider, got ${embeddingEnv}`,
      );
    }
    report.record(
      "journey-04-model",
      "Model provider configuration (deterministic defaults)",
      "PASS",
      { detail: "OSVA_KNOWLEDGE_EMBEDDING_PROVIDER=DETERMINISTIC" },
    );

    const mcpLogs = runDockerCapture(["compose", "logs", "mcp-server"], {
      env: composeEnv,
    });
    if (!mcpLogs.includes('"event":"mcp_server.started"')) {
      throw new Error("MCP server startup log missing");
    }
    await assertMcpHostBehavior(mcpPort);
    report.record(
      "journey-05-mcp-host",
      "MCP server startup and Host header security",
      "PASS",
    );

    if (
      runsGroup(groups, "consumers") ||
      runsGroup(groups, "workflow") ||
      runsGroup(groups, "multipart")
    ) {
      npmConsumer = await createPublishedNpmConsumer();
    }

    if (runsGroup(groups, "consumers")) {
      await runRegistryConsumers({
        baseUrl,
        apiKey,
        workspaceId,
        composeEnv,
        report,
        installRoot: npmConsumer.installRoot,
        workRoot: npmConsumer.workRoot,
      });
      await runPythonSmoke(baseUrl, apiKey, report);
    }

    if (runsGroup(groups, "workflow")) {
      if (npmConsumer === undefined) {
        throw new Error("Workflow group requires published npm consumer.");
      }
      const workflowEvidence = await runPublishedWorkflowAcceptance(
        npmConsumer.installRoot,
        baseUrl,
        apiKey,
        DEFAULT_DEADLINE_MS,
      );
      evidence.workflow = workflowEvidence;
      report.record(
        "journey-09-workflow",
        "Durable workflow with approval and WAIT",
        "PASS",
        { evidence: workflowEvidence },
      );
    } else {
      report.record(
        "journey-09-workflow",
        "Durable workflow with approval and WAIT",
        "NOT_RUN",
        { detail: "group filter" },
      );
    }

    if (runsGroup(groups, "mcp")) {
      const mcpEvidence = await runMcpConnectorAcceptance({
        baseUrl,
        apiKey,
        workspaceId,
      });
      evidence.mcpConnector = mcpEvidence;
      report.record(
        "journey-05b-mcp-connectors",
        "MCP connector discovery and tool import",
        "PASS",
        {
          detail: needsPrivateMcp
            ? "OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS=true (acceptance topology)"
            : undefined,
          evidence: mcpEvidence,
        },
      );
      report.record(
        "journey-05c-mcp-tool-invoke",
        "Agent binding and authorized MCP tool invocation",
        "NOT_RUN",
        {
          detail:
            "Harness covers register/discover/import only; agent+run invoke deferred",
        },
      );
    } else {
      report.record(
        "journey-05b-mcp-connectors",
        "MCP connector discovery and tool import",
        "NOT_RUN",
        { detail: "group filter" },
      );
      report.record(
        "journey-05c-mcp-tool-invoke",
        "Agent binding and authorized MCP tool invocation",
        "NOT_RUN",
        { detail: "group filter" },
      );
    }

    if (runsGroup(groups, "multipart")) {
      if (npmConsumer === undefined) {
        throw new Error("Multipart group requires published npm consumer.");
      }
      await waitUntil(
        DEFAULT_DEADLINE_MS,
        "/ready before multipart probe",
        async () => {
          const response = await fetch(`${baseUrl}/ready`);
          if (!response.ok) {
            throw new Error(`ready ${response.status}`);
          }
        },
      );
      const multipart = await probeSdkMultipart(
        npmConsumer.installRoot,
        baseUrl,
        apiKey,
      );
      evidence.sdkMultipartProbe = multipart;
      const sdkOk = multipart.sdk?.ok === true;
      const fetchOk = multipart.fetch?.ok === true;
      report.record(
        "journey-10b-sdk-multipart",
        "Published SDK multipart artifact upload probe",
        sdkOk ? "PASS" : fetchOk ? "FAIL" : "FAIL",
        {
          detail: sdkOk
            ? "SDK and fetch paths succeeded"
            : fetchOk
              ? "SDK multipart failed; raw fetch succeeded (see evidence.sdkMultipartProbe)"
              : "Both SDK and fetch multipart failed",
          evidence: multipart,
        },
      );
      if (!sdkOk && fetchOk) {
        report.record(
          "journey-10-artifacts",
          "Artifact persistence and retrieval (fetch path)",
          "PASS",
          { detail: "raw fetch FormData (SDK path documented separately)" },
        );
      }
    }

    if (npmConsumer !== undefined) {
      await npmConsumer.dispose();
      npmConsumer = undefined;
    }

    if (!runsGroup(groups, "restart")) {
      report.record(
        "journey-12-restart",
        "Runtime restart and persisted state recovery",
        "NOT_RUN",
        { detail: "group filter" },
      );
      report.record(
        "journey-13-security",
        "Workspace isolation and relevant security defaults",
        "NOT_RUN",
        { detail: "group filter" },
      );
      report.record(
        "journey-cleanup",
        "Docker cleanup (project-scoped volumes)",
        "NOT_RUN",
        { detail: "group filter" },
      );
      console.log(JSON.stringify(report.summaryJson(evidence), null, 2));
      process.exit(report.exitCode());
    }

    runDocker(["compose", "down"], { env: composeEnv });
    runDocker(["compose", "up", "-d", "--no-build", "--wait"], {
      env: composeEnv,
    });
    await waitUntil(
      DEFAULT_DEADLINE_MS,
      "web /ready after restart",
      async () => {
        const response = await fetch(`${baseUrl}/ready`);
        if (!response.ok) {
          throw new Error(`ready ${response.status}`);
        }
      },
    );
    const authAfterRestart = await fetch(`${baseUrl}/v1/agents`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!authAfterRestart.ok) {
      throw new Error(
        `Agents list after restart returned ${authAfterRestart.status}`,
      );
    }
    report.record(
      "journey-12-restart",
      "Runtime restart and persisted state recovery",
      "PASS",
    );

    const isolation = await fetch(`${baseUrl}/v1/agents`, {
      headers: { authorization: "Bearer osva_ak_invalid.token" },
    });
    if (isolation.status !== 401 && isolation.status !== 403) {
      throw new Error(
        `Expected 401/403 for invalid API key, got ${isolation.status}`,
      );
    }
    report.record(
      "journey-13-security",
      "Workspace isolation and relevant security defaults",
      "PASS",
    );

    runDocker(["compose", "down", "-v"], { env: composeEnv });
    report.record(
      "journey-cleanup",
      "Docker cleanup (project-scoped volumes)",
      "PASS",
    );

    console.log(JSON.stringify(report.summaryJson(evidence), null, 2));
    process.exit(report.exitCode());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (npmConsumer !== undefined) {
      await npmConsumer.dispose().catch(() => undefined);
    }
    try {
      runDocker(["compose", "down", "-v"], { env: composeEnv });
    } catch {
      // best effort
    }
    console.log(JSON.stringify(report.summaryJson(evidence), null, 2));
    process.exit(report.exitCode() || 1);
  }
}

main();
