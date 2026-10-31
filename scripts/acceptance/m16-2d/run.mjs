#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyInstallationImageContents } from "../../deployment/verify-installation-image.mjs";
import { CookieJar } from "./lib/cookie-jar.mjs";
import { allocatePortTriple } from "./lib/ports.mjs";
import { AcceptanceReport } from "./report.mjs";
import { assertRedacted, redactSecrets } from "./redact.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const DEFAULT_LOCAL_IMAGE = "osva/local-m16-2d:dev";
export const ADMIN_EMAIL = "acceptance-admin@install.local";
export const ADMIN_PASSWORD = "Acceptance-Install-Pw-12!";
const DEADLINE_MS = 20 * 60 * 1000;

function printHelp() {
  console.log(`Usage: pnpm acceptance:m16-2d

End-to-end OSVA installation acceptance (M16.2D).

Requires:
  OSVA_ACCEPTANCE_LIVE=1
  Docker Compose v2 and a running engine

Optional:
  OSVA_M16_LOCAL_IMAGE (default ${DEFAULT_LOCAL_IMAGE})
  OSVA_M16_SKIP_IMAGE_BUILD=1
  OSVA_M16_SKIP_TEARDOWN=1  (keep install dir + compose project for inspection)
  OSVA_M16_GROUPS=fresh,security,recovery,idempotency,agent (default: all)
`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    env: { ...process.env, ...options.env },
    shell: options.shell ?? false,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed${result.stderr ? `: ${redactSecrets(result.stderr)}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${redactSecrets(result.stderr || result.stdout)}`,
    );
  }
  return result.stdout;
}

function parseDotEnv(contents) {
  /** @type {Map<string, string>} */
  const values = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    values.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return values;
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          });
        });
      },
    );
    request.on("error", reject);
    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

async function waitForHttp(url, attempts = 60) {
  let lastStatus;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      lastStatus = response.status;
      if (response.ok) {
        return response;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Timed out waiting for ${url}${lastStatus ? ` (last ${lastStatus})` : ""}`,
  );
}

export function checkStatus(report, setupJson, id) {
  const match = setupJson.checks?.find((check) => check.id === id);
  if (!match) {
    report.record(id, id, "FAIL", {
      detail: "Check missing from setup JSON report.",
    });
    return;
  }
  report.record(
    id,
    id,
    match.status === "PASS"
      ? "PASS"
      : match.status === "SKIP"
        ? "SKIP"
        : "FAIL",
    {
      detail: match.message,
    },
  );
}

async function buildLocalImage(imageRef) {
  run("docker", ["build", "-t", imageRef, "-f", "Dockerfile", "."]);
}

export async function runInstaller(ctx) {
  const bootstrapKeyPath = path.join(
    ctx.installDir,
    ".acceptance-bootstrap-key",
  );
  const setupTokenPath = path.join(ctx.installDir, ".acceptance-setup-token");
  const cliBin =
    ctx.cliBin ??
    path.join(REPO_ROOT, "packages", "cli", "dist", "bin", "osva.js");
  /** @type {NodeJS.ProcessEnv} */
  const setupEnv = {
    ...process.env,
    OSVA_ACCEPTANCE_INSTALL: "1",
    OSVA_SETUP_BOOTSTRAP_KEY_FILE: bootstrapKeyPath,
    OSVA_SETUP_SETUP_TOKEN_FILE: setupTokenPath,
  };
  if (ctx.imageRef) {
    setupEnv.OSVA_SETUP_LOCAL_IMAGE = ctx.imageRef;
  }
  if (ctx.skipImagePull === true) {
    setupEnv.OSVA_SETUP_SKIP_IMAGE_PULL = "1";
  }
  const result = spawnSync(
    process.execPath,
    [
      cliBin,
      "setup",
      "--json",
      "--yes",
      "--install-dir",
      ctx.installDir,
      "--web-port",
      String(ctx.webPort),
      "--mcp-port",
      String(ctx.mcpPort),
      "--console-port",
      String(ctx.consolePort),
      "--admin-email",
      ADMIN_EMAIL,
      "--admin-name",
      "Acceptance Admin",
    ],
    {
      cwd: ctx.cwd ?? REPO_ROOT,
      encoding: "utf8",
      env: setupEnv,
    },
  );
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  assertRedacted(stdout);
  assertRedacted(stderr);
  if (result.status !== 0) {
    throw new Error(`osva setup failed: ${redactSecrets(stderr || stdout)}`);
  }
  const setupJson = JSON.parse(stdout);
  ctx.setupJson = setupJson;
  ctx.bootstrapKeyPath = bootstrapKeyPath;
  ctx.setupTokenPath = setupTokenPath;
  return setupJson;
}

async function readBootstrapKey(ctx) {
  try {
    const key = (await readFile(ctx.bootstrapKeyPath, "utf8")).trim();
    if (key.length === 0) {
      throw new Error("Bootstrap key file empty.");
    }
    ctx.bootstrapApiKey = key;
    return key;
  } catch (error) {
    throw new Error(
      `Could not read acceptance bootstrap key file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function consoleSecurityChecks(ctx, report) {
  const consoleUrl = `http://127.0.0.1:${ctx.consolePort}`;
  const ok = await fetch(`${consoleUrl}/`);
  if (!ok.ok) {
    report.record("console_security_http", "Console loopback GET /", "FAIL");
    return;
  }
  report.record("console_security_http", "Console loopback GET /", "PASS");

  const badHost = await httpRequest(`${consoleUrl}/api/v1/auth/session`, {
    method: "GET",
    headers: { Host: "evil.example.com" },
  });
  report.record(
    "console_security_host",
    "Console rejects non-loopback Host",
    badHost.status === 403 ? "PASS" : "FAIL",
    { detail: `status=${badHost.status}` },
  );

  const badOrigin = await fetch(`${consoleUrl}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      Host: `127.0.0.1:${ctx.consolePort}`,
      Origin: "https://evil.example.com",
    },
  });
  report.record(
    "console_security_origin",
    "Console rejects cross-origin mutation",
    badOrigin.status === 403 ? "PASS" : "FAIL",
    { detail: `status=${badOrigin.status}` },
  );

  const forwarded = await fetch(`${consoleUrl}/api/v1/auth/session`, {
    headers: {
      Host: `127.0.0.1:${ctx.consolePort}`,
      "X-Forwarded-Host": "evil.example.com",
    },
  });
  report.record(
    "console_security_forwarded",
    "Console ignores X-Forwarded-*",
    forwarded.status === 403 ? "PASS" : "FAIL",
    { detail: `status=${forwarded.status}` },
  );

  let publishBinding = "";
  try {
    publishBinding = runCapture(
      "docker",
      [
        "compose",
        "--project-directory",
        ctx.installDir,
        "--env-file",
        path.join(ctx.installDir, ".env"),
        "port",
        "console",
        "4174",
      ],
      { cwd: ctx.installDir },
    ).trim();
  } catch (error) {
    publishBinding =
      error instanceof Error ? error.message : "docker compose port failed";
  }
  const loopbackPublish =
    publishBinding.startsWith("127.0.0.1:") ||
    publishBinding.startsWith("::1:") ||
    publishBinding.startsWith("[::1]:");
  report.record(
    "console_security_publish",
    "Console published on loopback only (docker compose port)",
    loopbackPublish ? "PASS" : "FAIL",
    { detail: publishBinding.slice(0, 120) },
  );
}

export async function completeAdminSetup(ctx, report) {
  let setupToken;
  try {
    setupToken = (await readFile(ctx.setupTokenPath, "utf8")).trim();
    if (setupToken.length === 0) {
      setupToken = undefined;
    }
  } catch {
    setupToken = undefined;
  }
  if (setupToken === undefined) {
    const skip = ctx.setupJson?.checks?.find(
      (check) => check.id === "administrator_bootstrapped",
    );
    if (skip?.status === "PASS") {
      report.record(
        "administrator_setup_complete",
        "Administrator password setup",
        "SKIP",
        { detail: "Administrator already active; no setup token issued." },
      );
      return;
    }
    report.record(
      "administrator_setup_complete",
      "Administrator password setup",
      "FAIL",
      {
        detail:
          "Setup token missing from in-process report (JSON excludes tokens).",
      },
    );
    return;
  }

  const webOrigin = `http://127.0.0.1:${ctx.webPort}`;
  const consoleOrigin = `http://127.0.0.1:${ctx.consolePort}`;
  const setupResponse = await httpRequest(
    `${consoleOrigin}/api/v1/auth/setup/complete`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: setupToken, password: ADMIN_PASSWORD }),
    },
  );
  report.record(
    "administrator_setup_complete",
    "Administrator password setup via Console BFF",
    setupResponse.status >= 200 && setupResponse.status < 300 ? "PASS" : "FAIL",
    { detail: `status=${setupResponse.status}` },
  );

  const jar = new CookieJar();
  const login = await httpRequest(`${consoleOrigin}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  jar.absorbFromHeaders(login.headers);
  report.record(
    "administrator_login",
    "Administrator login via Console BFF",
    login.status >= 200 && login.status < 300 ? "PASS" : "FAIL",
    { detail: `status=${login.status}` },
  );

  const me = await httpRequest(`${consoleOrigin}/api/v1/auth/me`, {
    headers: {
      ...(jar.header() ? { Cookie: jar.header() } : {}),
    },
  });
  report.record(
    "administrator_session",
    "Authenticated /auth/me with session cookie",
    me.status >= 200 && me.status < 300 ? "PASS" : "FAIL",
    { detail: `status=${me.status}` },
  );

  const onboarding = await fetch(`${consoleOrigin}/onboarding`, {
    headers: {
      Host: `127.0.0.1:${ctx.consolePort}`,
      ...(jar.header() ? { Cookie: jar.header() } : {}),
    },
  });
  report.record(
    "console_onboarding_route",
    "Console onboarding route reachable when authenticated",
    onboarding.ok ? "PASS" : "FAIL",
    { detail: `status=${onboarding.status}` },
  );

  ctx.cookieJar = jar;
  ctx.webOrigin = webOrigin;
  ctx.consoleOrigin = consoleOrigin;
}

async function resolveWorkspaceIdFromApiKey(baseUrl, apiKey) {
  const response = await fetch(`${baseUrl}/v1/auth/context`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(
      `auth/context failed with status ${String(response.status)}`,
    );
  }
  const body = await response.json();
  const workspaceId = body?.workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new Error("auth/context did not return workspaceId.");
  }
  return workspaceId;
}

export async function runHelloAgent(ctx, report) {
  run("pnpm", ["--filter", "@osva/example-hello-agent", "build"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  await readBootstrapKey(ctx);
  const webBase = `http://127.0.0.1:${ctx.webPort}`;
  let workspaceId;
  try {
    workspaceId = await resolveWorkspaceIdFromApiKey(
      webBase,
      ctx.bootstrapApiKey,
    );
  } catch (error) {
    report.record(
      "first_agent_run_succeeded",
      "Hello Agent run reached SUCCEEDED with persisted output",
      "FAIL",
      {
        detail: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
      },
    );
    return;
  }
  const envFile = parseDotEnv(
    await readFile(path.join(ctx.installDir, ".env"), "utf8"),
  );
  const composeProject = envFile.get("COMPOSE_PROJECT_NAME");
  const hello = spawnSync(
    process.execPath,
    [
      path.join(
        REPO_ROOT,
        "examples",
        "hello-agent",
        "dist",
        "scripts",
        "run.js",
      ),
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        OSVA_BASE_URL: webBase,
        OSVA_API_KEY: ctx.bootstrapApiKey,
        OSVA_WORKSPACE_ID: workspaceId,
        OSVA_HELLO_TRUSTED_RUNTIME_MODE: "compose",
        OSVA_COMPOSE_DIR: ctx.installDir,
        ...(composeProject ? { COMPOSE_PROJECT_NAME: composeProject } : {}),
      },
    },
  );
  assertRedacted(hello.stdout ?? "");
  assertRedacted(hello.stderr ?? "");
  const helloOutput = `${hello.stdout ?? ""}\n${hello.stderr ?? ""}`;
  const succeeded =
    hello.status === 0 && /Status:\s+SUCCEEDED/m.test(helloOutput);
  report.record(
    "first_agent_run_succeeded",
    "Hello Agent run reached SUCCEEDED with persisted output",
    succeeded ? "PASS" : "FAIL",
    {
      detail: redactSecrets(
        (hello.stderr || hello.stdout || "hello-agent run failed").slice(
          0,
          400,
        ),
      ),
    },
  );
}

async function idempotencyChecks(ctx, report) {
  const envBefore = await readFile(path.join(ctx.installDir, ".env"), "utf8");
  const cliBin = path.join(
    REPO_ROOT,
    "packages",
    "cli",
    "dist",
    "bin",
    "osva.js",
  );

  const withoutYes = spawnSync(
    process.execPath,
    [cliBin, "setup", "--json", "--install-dir", ctx.installDir],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        OSVA_SETUP_LOCAL_IMAGE: ctx.imageRef,
        OSVA_SETUP_SKIP_IMAGE_PULL: "1",
      },
    },
  );
  const envAfterNo = await readFile(path.join(ctx.installDir, ".env"), "utf8");
  report.record(
    "idempotency_no_yes",
    "Rerun setup without --yes preserves .env secrets",
    envBefore === envAfterNo ? "PASS" : "FAIL",
  );

  const withYes = spawnSync(
    process.execPath,
    [
      cliBin,
      "setup",
      "--json",
      "--yes",
      "--install-dir",
      ctx.installDir,
      "--web-port",
      String(ctx.webPort),
      "--mcp-port",
      String(ctx.mcpPort),
      "--console-port",
      String(ctx.consolePort),
      "--admin-email",
      ADMIN_EMAIL,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        OSVA_SETUP_LOCAL_IMAGE: ctx.imageRef,
        OSVA_SETUP_SKIP_IMAGE_PULL: "1",
        OSVA_ACCEPTANCE_INSTALL: "1",
      },
    },
  );
  const envAfterYes = await readFile(path.join(ctx.installDir, ".env"), "utf8");
  const beforeSecrets = parseDotEnv(envBefore);
  const afterSecrets = parseDotEnv(envAfterYes);
  report.record(
    "idempotency_yes_secrets",
    "Rerun setup with --yes preserves POSTGRES_PASSWORD and OSVA_AUTH_SECRET",
    beforeSecrets.get("POSTGRES_PASSWORD") ===
      afterSecrets.get("POSTGRES_PASSWORD") &&
      beforeSecrets.get("OSVA_AUTH_SECRET") ===
        afterSecrets.get("OSVA_AUTH_SECRET")
      ? "PASS"
      : "FAIL",
  );
  report.record(
    "idempotency_yes_no_duplicate_admin",
    "Rerun setup with --yes does not fail administrator bootstrap",
    withYes.status === 0 ? "PASS" : "FAIL",
    { detail: redactSecrets(withYes.stderr || withYes.stdout || "") },
  );
}

export async function composeValidate(ctx, report) {
  runCapture(
    "docker",
    [
      "compose",
      "--project-directory",
      ctx.installDir,
      "--env-file",
      path.join(ctx.installDir, ".env"),
      "config",
    ],
    { cwd: ctx.installDir },
  );
  report.record("compose_config", "docker compose config", "PASS");
}

async function teardown(ctx) {
  if (process.env.OSVA_M16_SKIP_TEARDOWN === "1") {
    console.log(`Skipping teardown; install dir ${ctx.installDir}`);
    return;
  }
  const envFile = parseDotEnv(
    await readFile(path.join(ctx.installDir, ".env"), "utf8"),
  );
  const project = envFile.get("COMPOSE_PROJECT_NAME");
  runCapture(
    "docker",
    [
      "compose",
      "--project-directory",
      ctx.installDir,
      "--env-file",
      path.join(ctx.installDir, ".env"),
      "down",
    ],
    { env: project ? { COMPOSE_PROJECT_NAME: project } : {} },
  );
  await rm(ctx.installDir, { recursive: true, force: true });
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  if (process.env.OSVA_ACCEPTANCE_LIVE !== "1") {
    console.error(
      "Refusing live M16.2D acceptance without OSVA_ACCEPTANCE_LIVE=1.",
    );
    printHelp();
    process.exit(1);
  }

  const report = new AcceptanceReport();
  const imageRef =
    process.env.OSVA_M16_LOCAL_IMAGE?.trim() || DEFAULT_LOCAL_IMAGE;
  const groups = new Set(
    (process.env.OSVA_M16_GROUPS ?? "fresh,security,recovery,idempotency,agent")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );

  run("pnpm", ["exec", "turbo", "run", "build", "--filter=@osva-ai/cli..."], {
    shell: process.platform === "win32",
  });

  if (process.env.OSVA_M16_SKIP_IMAGE_BUILD !== "1") {
    await buildLocalImage(imageRef);
  }

  verifyInstallationImageContents(imageRef);
  report.record(
    "oci_image_smoke",
    "Local OCI installation image smoke",
    "PASS",
    {
      evidence: { imageRef },
    },
  );

  const ports = await allocatePortTriple();
  const installDir = await mkdtemp(path.join(os.tmpdir(), "osva-m16-2d-"));
  /** @type {any} */
  const ctx = {
    imageRef,
    installDir,
    skipImagePull: true,
    ...ports,
  };

  const started = Date.now();
  try {
    if (groups.has("fresh")) {
      const setupJson = await runInstaller(ctx);
      await composeValidate(ctx, report);
      for (const id of [
        "platform_services_ready",
        "console_distribution",
        "console_ready",
        "administrator_bootstrapped",
      ]) {
        checkStatus(report, setupJson, id);
      }
      report.record(
        "installation_complete",
        "installation_complete check from setup JSON",
        setupJson.checks?.some(
          (check) =>
            check.id === "installation_complete" && check.status === "PASS",
        )
          ? "PASS"
          : "SKIP",
        {
          detail:
            "Expected SKIP until password setup + sign-in; full installation_complete requires operator onboarding.",
        },
      );
    }

    if (groups.has("security")) {
      await consoleSecurityChecks(ctx, report);
    }

    if (groups.has("fresh")) {
      await completeAdminSetup(ctx, report);
    }

    if (groups.has("agent")) {
      await runHelloAgent(ctx, report);
    }

    if (groups.has("idempotency")) {
      await idempotencyChecks(ctx, report);
    }

    if (groups.has("recovery")) {
      report.record(
        "recovery_lost_setup_token",
        "identity-recover available for lost setup token",
        "SKIP",
        {
          detail:
            "Use OSVA_PROCESS=identity-recover against the install compose project; not executed in default Windows live run.",
        },
      );
    }
  } finally {
    if (ctx.bootstrapKeyPath) {
      await writeFile(ctx.bootstrapKeyPath, "", { mode: 0o600 }).catch(
        () => {},
      );
    }
    await teardown(ctx).catch((error) => {
      console.error(
        redactSecrets(error instanceof Error ? error.message : String(error)),
      );
    });
  }

  const summary = report.summary();
  console.log(
    JSON.stringify({ summary, elapsedMs: Date.now() - started }, null, 2),
  );
  report.assertAllPass();
  console.log("acceptance:m16-2d PASS");
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(
      redactSecrets(error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  });
}
