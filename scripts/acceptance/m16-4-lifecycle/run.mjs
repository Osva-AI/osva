#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allocatePortTriple } from "../m16-2d/lib/ports.mjs";
import { AcceptanceReport } from "../m16-2d/report.mjs";
import { redactSecrets } from "../m16-2d/redact.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const DEFAULT_LOCAL_IMAGE = "osva/local-m16-4-lifecycle:dev";
const ADMIN_EMAIL = "acceptance-lifecycle@install.local";

function runCli(args, env = {}) {
  const cliBin = path.join(
    REPO_ROOT,
    "packages",
    "cli",
    "dist",
    "bin",
    "osva.js",
  );
  const result = spawnSync(process.execPath, [cliBin, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return result;
}

async function main() {
  if (process.env.OSVA_ACCEPTANCE_LIVE !== "1") {
    console.error(
      "Set OSVA_ACCEPTANCE_LIVE=1 to run M16.4 lifecycle acceptance.",
    );
    process.exit(1);
  }

  const report = new AcceptanceReport();
  const imageRef =
    process.env.OSVA_M16_LOCAL_IMAGE?.trim() || DEFAULT_LOCAL_IMAGE;

  spawnSync(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter=@osva-ai/cli..."],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  if (process.env.OSVA_M16_SKIP_IMAGE_BUILD !== "1") {
    spawnSync("docker", ["build", "-t", imageRef, "-f", "Dockerfile", "."], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  }

  const ports = await allocatePortTriple();
  const installDir = await mkdtemp(
    path.join(os.tmpdir(), "osva-m16-4-lifecycle-"),
  );

  try {
    const setup = runCli(
      [
        "setup",
        "--json",
        "--yes",
        "--install-dir",
        installDir,
        "--web-port",
        String(ports.webPort),
        "--mcp-port",
        String(ports.mcpPort),
        "--console-port",
        String(ports.consolePort),
        "--admin-email",
        ADMIN_EMAIL,
      ],
      {
        OSVA_SETUP_LOCAL_IMAGE: imageRef,
        OSVA_SETUP_SKIP_IMAGE_PULL: "1",
        OSVA_ACCEPTANCE_INSTALL: "1",
      },
    );
    report.record("setup", "osva setup", setup.status === 0 ? "PASS" : "FAIL", {
      detail: redactSecrets(setup.stderr || setup.stdout).slice(0, 200),
    });
    if (setup.status !== 0) {
      throw new Error("setup failed");
    }

    const status1 = runCli(["platform", "status", "--install-dir", installDir]);
    report.record(
      "platform_status",
      "platform status (running)",
      status1.status === 0 ? "PASS" : "WARN",
    );

    const stop = runCli(["platform", "stop", "--install-dir", installDir]);
    report.record(
      "platform_stop",
      "platform stop",
      stop.status === 0 ? "PASS" : "FAIL",
    );

    const status2 = runCli([
      "platform",
      "status",
      "--install-dir",
      installDir,
      "--json",
    ]);
    report.record(
      "platform_status_stopped",
      "platform status after stop",
      status2.status === 1 ? "PASS" : "WARN",
    );

    const start = runCli(["platform", "start", "--install-dir", installDir]);
    report.record(
      "platform_start",
      "platform start (no pull/migrate)",
      start.status === 0 ? "PASS" : "FAIL",
    );

    const restart = runCli([
      "platform",
      "restart",
      "--install-dir",
      installDir,
    ]);
    report.record(
      "platform_restart",
      "platform restart",
      restart.status === 0 ? "PASS" : "FAIL",
    );

    const doctor = runCli(["platform", "doctor", "--install-dir", installDir]);
    report.record(
      "platform_doctor",
      "platform doctor",
      doctor.status === 0 ? "PASS" : "WARN",
    );

    const logs = runCli([
      "platform",
      "logs",
      "--install-dir",
      installDir,
      "--service",
      "web",
      "--tail",
      "20",
    ]);
    report.record(
      "platform_logs",
      "platform logs",
      logs.status === 0 ? "PASS" : "FAIL",
    );

    report.record(
      "platform_upgrade_live",
      "platform upgrade (two distinct versions)",
      "NOT_RUN",
      {
        detail:
          "Live cross-version upgrade requires two compatible built images; use hermetic upgrade unit tests.",
      },
    );

    console.log(JSON.stringify(report.summary(), null, 2));
    report.assertAllPass();
  } finally {
    if (process.env.OSVA_M16_SKIP_TEARDOWN !== "1") {
      spawnSync(
        "docker",
        [
          "compose",
          "--project-directory",
          installDir,
          "--env-file",
          path.join(installDir, ".env"),
          "down",
        ],
        { cwd: installDir, stdio: "inherit" },
      );
      await rm(installDir, { recursive: true, force: true });
    } else {
      console.log(`Skipping teardown; install dir ${installDir}`);
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
