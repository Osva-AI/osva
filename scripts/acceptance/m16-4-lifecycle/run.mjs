#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { allocatePortTriple } from "../m16-2d/lib/ports.mjs";
import { AcceptanceReport } from "../m16-2d/report.mjs";
import { redactSecrets } from "../m16-2d/redact.mjs";
import { runM16LifecycleJourney } from "../m16-shared/lifecycle-journey.mjs";
import { runCli } from "../m16-shared/cli-runner.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const DEFAULT_LOCAL_IMAGE = "osva/local-m16-4-lifecycle:dev";
const ADMIN_EMAIL = "acceptance-lifecycle@install.local";

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
  const cliBin =
    process.env.OSVA_M16_CLI_BIN?.trim() ||
    path.join(REPO_ROOT, "packages", "cli", "dist", "bin", "osva.js");

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
      cliBin,
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

    await runM16LifecycleJourney(report, {
      cliBin,
      installDir,
      consolePort: String(ports.consolePort),
    });

    report.record(
      "platform_upgrade_live",
      "platform upgrade (two distinct versions)",
      "NOT_RUN",
      {
        detail:
          "Cross-version upgrade runs in acceptance:m16-registry (Stage B) or local-pack with OSVA_M16_GROUPS=upgrade.",
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
