import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildInstallEnvValues,
  composeBaseArgs,
  composeCommandIncludesDestructiveVolumeRemoval,
  detectShellEnvConflicts,
  materializeInstallation,
  parseDotEnv,
  readSetupOptions,
  runSetupProvision,
} from "../src/setup/index.js";
import { INSTALL_ENV_KEYS } from "../src/setup/env-file.js";
import type { ProbeSpawnFn } from "../src/setup/probe-spawn.js";
import { loadComposeDistribution } from "../src/setup/distribution.js";

const TEMP_DIRS: string[] = [];

afterEach(async () => {
  await Promise.all(
    TEMP_DIRS.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("osva setup provisioning", () => {
  it("resolves install directory defaults and flags", () => {
    const options = readSetupOptions(
      {
        "install-dir": "./custom-install",
        yes: true,
        "preflight-only": true,
      },
      {},
      "linux",
    );
    expect(options.installDir).toContain("custom-install");
    expect(options.authorizeExisting).toBe(true);
    expect(options.preflightOnly).toBe(true);
  });

  it("materializes compose and env atomically on a fresh directory", async () => {
    const installDir = await makeTempDir("osva-setup-fresh-");
    const distribution = await loadComposeDistribution();
    const options = readSetupOptions({}, {}, "linux");
    const result = await materializeInstallation({
      options: { ...options, installDir },
      distribution,
      processEnv: {},
    });
    expect(result.preservedSecrets).toBe(false);
    expect(result.wroteCompose).toBe(true);
    expect(result.wroteEnv).toBe(true);
    const envContents = await readFile(result.envPath, "utf8");
    expect(envContents).toContain("ghcr.io/osva-ai/osva:1.1.0");
    expect(envContents).toMatch(/POSTGRES_PASSWORD=[0-9a-f]{64}/);
    expect(envContents).toMatch(/OSVA_AUTH_SECRET=[0-9a-f]{64}/);
    const composeContents = await readFile(result.composePath, "utf8");
    expect(composeContents).not.toContain("build:");
    expect(composeContents).toContain("OSVA_IMAGE:?OSVA_IMAGE is required");
    expect(composeContents).toContain("127.0.0.1:${OSVA_PUBLISH_WEB_PORT");
    expect(composeContents).toContain("OSVA_CONSOLE_DOCKER_PUBLISH");
    expect(composeContents).toContain("identity-bootstrap");
    expect(envContents).toMatch(/COMPOSE_PROJECT_NAME=osva-[0-9a-f]{12}/);
    const marker = JSON.parse(await readFile(result.markerPath, "utf8")) as {
      imageRef: string;
    };
    expect(marker.imageRef).toBe("ghcr.io/osva-ai/osva:1.1.0");
  });

  it("preserves secrets on repeated materialization", async () => {
    const installDir = await makeTempDir("osva-setup-repeat-");
    const distribution = await loadComposeDistribution();
    const baseOptions = readSetupOptions({}, {}, "linux");
    const first = await materializeInstallation({
      options: { ...baseOptions, installDir },
      distribution,
      processEnv: {},
    });
    const envBefore = await readFile(first.envPath, "utf8");
    const second = await materializeInstallation({
      options: { ...baseOptions, installDir, webPort: 9091, mcpPort: 9092 },
      distribution,
      processEnv: {},
    });
    const envAfter = await readFile(second.envPath, "utf8");
    const beforeSecrets = parseDotEnv(envBefore);
    const afterSecrets = parseDotEnv(envAfter);
    expect(afterSecrets.get("POSTGRES_PASSWORD")).toBe(
      beforeSecrets.get("POSTGRES_PASSWORD"),
    );
    expect(afterSecrets.get("OSVA_AUTH_SECRET")).toBe(
      beforeSecrets.get("OSVA_AUTH_SECRET"),
    );
    expect(afterSecrets.get("OSVA_PUBLISH_WEB_PORT")).toBe("9091");
    expect(second.preservedSecrets).toBe(true);
  });

  it("refuses unrelated files in the install directory", async () => {
    const installDir = await makeTempDir("osva-setup-foreign-");
    await writeFile(
      path.join(installDir, "notes.txt"),
      "keep my data\n",
      "utf8",
    );
    const distribution = await loadComposeDistribution();
    const options = readSetupOptions({}, {}, "linux");
    await expect(
      materializeInstallation({
        options: { ...options, installDir },
        distribution,
        processEnv: {},
      }),
    ).rejects.toMatchObject({ code: "foreign_directory" });
  });

  it("detects conflicting host environment overrides", () => {
    const values = buildInstallEnvValues({
      imageRef: "ghcr.io/osva-ai/osva:1.1.0",
      composeProjectName: "osva-deadbeef0123",
      webPort: 8080,
      mcpPort: 3100,
      consolePort: 4174,
      generateSecret: () => "a".repeat(64),
    });
    const conflicts = detectShellEnvConflicts(values, {
      POSTGRES_PASSWORD: "different".padEnd(64, "x"),
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.key).toBe("POSTGRES_PASSWORD");
  });

  it("builds compose commands without destructive volume removal", () => {
    expect(
      composeCommandIncludesDestructiveVolumeRemoval(["compose", "down", "-v"]),
    ).toBe(true);
    expect(
      composeCommandIncludesDestructiveVolumeRemoval(["compose", "up", "-d"]),
    ).toBe(false);
    const args = composeBaseArgs({
      installDir: "/tmp/osva",
      envFilePath: "/tmp/osva/.env",
      projectName: "osva-self-hosted",
    });
    expect(args).toContain("--env-file");
    expect(args).toContain("--project-name");
    expect(args.join(" ")).toContain("/tmp/osva/.env");
  });

  it("runs staged docker compose provisioning with mocked subprocesses", async () => {
    const installDir = await makeTempDir("osva-setup-provision-");
    const calls: string[] = [];
    const spawn: ProbeSpawnFn = (executable, args) => {
      expect(executable).toBe("docker");
      const joined = args.join(" ");
      calls.push(joined);
      if (joined.includes("compose version") || joined === "--version") {
        return healthyDockerProbe(args);
      }
      if (joined.includes("config")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("pull")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("up") && joined.includes("postgres")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("up") && joined.includes("migrate")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("up") && joined.includes("console")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("up") && joined.includes("web")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("ps") && joined.includes("running")) {
        return { status: 1, stdout: "", stderr: "", error: undefined };
      }
      return {
        status: 1,
        stdout: "",
        stderr: `unexpected: ${joined}`,
        error: undefined,
      };
    };

    const options = readSetupOptions(
      { "web-port": "48080", "mcp-port": "43100" },
      {},
      "linux",
    );
    let installationStatusReads = 0;
    const spawnWithOnboarding: ProbeSpawnFn = (executable, args) => {
      const joined = args.join(" ");
      if (
        joined.includes("run") &&
        joined.includes("web") &&
        joined.includes("accessSync")
      ) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("installation-status")) {
        installationStatusReads += 1;
        const snapshot =
          installationStatusReads === 1
            ? {
                schemaVersion: 1,
                workspaceCount: 0,
                apiKeyCount: 0,
                organizationCount: 0,
                humanUserCount: 0,
                pendingSetupUserCount: 0,
                unlinkedWorkspaceIds: [],
              }
            : {
                schemaVersion: 1,
                workspaceCount: 1,
                apiKeyCount: 1,
                organizationCount: 0,
                humanUserCount: 0,
                pendingSetupUserCount: 0,
                unlinkedWorkspaceIds: ["11111111-1111-1111-1111-111111111111"],
              };
        return {
          status: 0,
          stdout: `${JSON.stringify(snapshot)}\n`,
          stderr: "",
          error: undefined,
        };
      }
      if (joined.includes("up") && joined.includes("console")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("identity-bootstrap")) {
        return {
          status: 0,
          stdout: [
            "One-time password setup token (single use; do not log or share):",
            "setup-token-for-test",
            "",
          ].join("\n"),
          stderr: "",
          error: undefined,
        };
      }
      if (
        joined.includes("--profile bootstrap") &&
        joined.includes(" run ") &&
        !joined.includes("identity-bootstrap")
      ) {
        return {
          status: 0,
          stdout: [
            "OSVA installation bootstrap completed.",
            "Workspace ID: 11111111-1111-1111-1111-111111111111",
            "",
          ].join("\n"),
          stderr: "",
          error: undefined,
        };
      }
      return spawn(executable, args, 120_000);
    };

    const provision = await runSetupProvision(
      { ...options, installDir, adminEmail: "owner@example.com" },
      {
        spawn: spawnWithOnboarding,
        processEnv: provisionTestProcessEnv(),
        fetch: async (url) => {
          const target = String(url);
          if (
            target.includes("/health") ||
            target.includes("/ready") ||
            target.endsWith(":4174/") ||
            target.endsWith(":4174")
          ) {
            return new Response(null, { status: 200 });
          }
          return new Response(null, { status: 503 });
        },
      },
    );
    const checks = provision.checks;
    expect(
      checks.find((check) => check.id === "platform_services_ready")?.status,
    ).toBe("PASS");
    expect(checks.find((check) => check.id === "console_ready")?.status).toBe(
      "PASS",
    );
    expect(provision.setupTokenForOperator).toBe("setup-token-for-test");
    expect(
      checks.find((check) => check.id === "administrator_bootstrapped")?.status,
    ).toBe("PASS");
    expect(
      checks.find((check) => check.id === "installation_complete")?.status,
    ).toBe("SKIP");
    expect(
      calls.some((call) => call.includes("down") && call.includes("-v")),
    ).toBe(false);
    expect(calls.some((call) => call.includes("pull"))).toBe(true);
    const migrateCalls = calls.filter(
      (call) => call.includes("migrate") && call.includes("up"),
    );
    expect(migrateCalls).toHaveLength(1);
    expect(
      calls.some((call) => call.includes("run") && call.includes("migrate")),
    ).toBe(false);
  });

  it("skips migration when reconciling an operational deployment with --yes", async () => {
    const installDir = await makeTempDir("osva-setup-reconcile-");
    const calls: string[] = [];
    const spawn: ProbeSpawnFn = (_executable, args) => {
      const joined = args.join(" ");
      calls.push(joined);
      if (joined.includes("ps") && joined.includes("running")) {
        return {
          status: 0,
          stdout: "web\nworker\n",
          stderr: "",
          error: undefined,
        };
      }
      if (joined.includes("config") || joined.includes("pull")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("up") && joined.includes("web")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      if (joined.includes("up") && joined.includes("postgres")) {
        return { status: 0, stdout: "", stderr: "", error: undefined };
      }
      return { status: 0, stdout: "", stderr: "", error: undefined };
    };
    const options = readSetupOptions({ yes: true }, {}, "linux");
    const provision = await runSetupProvision(
      { ...options, installDir },
      {
        spawn,
        processEnv: {},
        fetch: async () => new Response(null, { status: 200 }),
      },
    );
    expect(
      provision.checks.find((check) => check.id === "compose_migrate")?.status,
    ).toBe("SKIP");
    expect(calls.some((call) => call.includes("migrate"))).toBe(false);
  });

  it("redacts secrets from provisioning failure messages", async () => {
    const installDir = await makeTempDir("osva-setup-fail-");
    const secret = "a".repeat(64);
    const spawn: ProbeSpawnFn = (executable, args) => {
      const joined = args.join(" ");
      if (joined.includes("config")) {
        return {
          status: 1,
          stdout: "",
          stderr: `invalid POSTGRES_PASSWORD=${secret}`,
          error: undefined,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: undefined };
    };
    const options = readSetupOptions({}, {}, "linux");
    const provision = await runSetupProvision(
      { ...options, installDir },
      { spawn, processEnv: {} },
    );
    const failure = provision.checks.find(
      (check) => check.id === "compose_provision",
    );
    expect(failure?.status).toBe("FAIL");
    expect(failure?.message).not.toContain(secret);
  });
});

function provisionTestProcessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OSVA_SETUP_SKIP_IMAGE_PULL;
  delete env.OSVA_SETUP_LOCAL_IMAGE;
  delete env.OSVA_ACCEPTANCE_INSTALL;
  for (const key of INSTALL_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}

function healthyDockerProbe(args: readonly string[]): {
  status: number;
  stdout: string;
  stderr: string;
  error: undefined;
} {
  const joined = args.join(" ");
  if (joined.includes("compose version") || joined.endsWith("--version")) {
    return {
      status: 0,
      stdout: "Docker version 27.0.0\n",
      stderr: "",
      error: undefined,
    };
  }
  return { status: 0, stdout: "", stderr: "", error: undefined };
}
