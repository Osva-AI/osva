#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyInstallationImageContents } from "../../deployment/verify-installation-image.mjs";
import {
  ADMIN_EMAIL,
  checkStatus,
  completeAdminSetup,
  composeValidate,
  consoleSecurityChecks,
  runHelloAgent,
  runInstaller,
} from "../m16-2d/run.mjs";
import { allocatePortTriple } from "../m16-2d/lib/ports.mjs";
import { AcceptanceReport } from "../m16-2d/report.mjs";
import { redactSecrets } from "../m16-2d/redact.mjs";
import { runM16LifecycleJourney } from "../m16-shared/lifecycle-journey.mjs";
import { runCli } from "../m16-shared/cli-runner.mjs";
import { resolveM16Artifacts } from "./lib/resolve-artifacts.mjs";
import { runM16UpgradeJourney } from "./lib/upgrade-journey.mjs";
import { M16_111_TARGET } from "../r11-registry-only/lib/targets.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function printHelp() {
  console.log(`Usage: pnpm acceptance:m16-registry

M16 registry-only external-consumer acceptance (installation + lifecycle + upgrade).

Stage B (published):
  OSVA_M16_REGISTRY_ACCEPTANCE=1
  OSVA_REGISTRY_ACCEPTANCE_TARGET=m16-111
  OSVA_M16_ARTIFACT_SOURCE=published
  OSVA_ACCEPTANCE_LIVE=1

Stage A (local-pack smoke, not registry-verified):
  OSVA_ACCEPTANCE_LIVE=1
  OSVA_M16_ARTIFACT_SOURCE=local-pack
  OSVA_M16_SKIP_IMAGE_BUILD=1   (optional, after local docker build)

Groups (OSVA_M16_GROUPS):
  preflight, install, lifecycle, upgrade  (default: preflight,install,lifecycle,upgrade)

Optional:
  OSVA_M16_SKIP_TEARDOWN=1
`);
}

function parseGroups() {
  return new Set(
    (process.env.OSVA_M16_GROUPS ?? "preflight,install,lifecycle,upgrade")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
  );
}

async function teardown(installDir) {
  if (process.env.OSVA_M16_SKIP_TEARDOWN === "1") {
    console.log(`Skipping teardown; install dir ${installDir}`);
    return;
  }
  const { spawnSync } = await import("node:child_process");
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
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const groups = parseGroups();
  const report = new AcceptanceReport();
  /** @type {import("./lib/resolve-artifacts.mjs").M16ArtifactBundle | undefined} */
  let artifacts;

  try {
    if (groups.has("preflight")) {
      try {
        artifacts = await resolveM16Artifacts();
        report.record("artifact_resolution", "Resolve M16 artifacts", "PASS", {
          evidence: {
            source: artifacts.source,
            npm: artifacts.target.npmPackageVersion,
            image: artifacts.imageRef,
          },
        });
        if (artifacts.source === "published") {
          verifyInstallationImageContents(artifacts.imageRef);
          report.record(
            "oci_installation_smoke",
            "Published OCI installation smoke",
            "PASS",
          );
        } else {
          verifyInstallationImageContents(artifacts.imageRef);
          report.record(
            "oci_installation_smoke",
            "Local-pack OCI installation smoke",
            "PASS",
            { detail: "Stage A only — not registry-verified." },
          );
        }
        const help = runCli(artifacts.cliBin, ["help"]).stdout ?? "";
        for (const needle of ["setup", "platform status"]) {
          if (!help.includes(needle)) {
            throw new Error(`CLI help missing ${needle}`);
          }
        }
        report.record(
          "cli_help_m16",
          "Published/packed CLI exposes M16 commands",
          "PASS",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          M16_111_TARGET.registryArtifactsReady === false &&
          (process.env.OSVA_M16_ARTIFACT_SOURCE ?? "published") === "published"
        ) {
          report.record(
            "artifact_resolution",
            "Resolve M16 artifacts",
            "NOT_RUN",
            {
              detail: message,
            },
          );
          report.record(
            "registry_install_journey",
            "Registry install journey",
            "NOT_RUN",
            {
              detail: "Blocked until platform 1.1.1 and npm 1.1.2 publish.",
            },
          );
          report.record(
            "registry_lifecycle_journey",
            "Registry lifecycle journey",
            "NOT_RUN",
          );
          report.record(
            "registry_upgrade_journey",
            "Registry upgrade journey",
            "NOT_RUN",
          );
          const outPath = path.join(
            REPO_ROOT,
            "artifacts",
            "acceptance",
            "m16-registry-report.json",
          );
          await import("node:fs/promises").then(({ mkdir }) =>
            mkdir(path.dirname(outPath), { recursive: true }),
          );
          await writeFile(
            outPath,
            `${JSON.stringify({ summary: report.summary(), stage: "A-blocked" }, null, 2)}\n`,
          );
          console.log(JSON.stringify(report.summary(), null, 2));
          console.log(
            "M16 registry acceptance NOT_RUN (published artifacts unavailable). Stage A source prep complete.",
          );
          return;
        }
        throw error;
      }
    } else {
      artifacts = await resolveM16Artifacts();
    }

    if (!artifacts) {
      throw new Error("Artifacts not resolved");
    }

    if (process.env.OSVA_ACCEPTANCE_LIVE !== "1") {
      report.record("live_gate", "OSVA_ACCEPTANCE_LIVE=1", "NOT_RUN");
      console.log(JSON.stringify(report.summary(), null, 2));
      return;
    }

    const ports = await allocatePortTriple();
    const installDir = await mkdtemp(
      path.join(os.tmpdir(), "osva-m16-registry-"),
    );
    const pullPublished = artifacts.source === "published";

    /** @type {any} */
    const ctx = {
      cliBin: artifacts.cliBin,
      imageRef: artifacts.imageRef,
      installDir,
      skipImagePull: !pullPublished,
      cwd: pullPublished ? installDir : REPO_ROOT,
      ...ports,
    };

    try {
      if (groups.has("install")) {
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
        await consoleSecurityChecks(ctx, report);
        await completeAdminSetup(ctx, report);
        await runHelloAgent(ctx, report);
        report.record(
          "registry_install_journey",
          "Registry install + onboarding + agent run",
          "PASS",
        );
      }

      if (groups.has("lifecycle")) {
        await runM16LifecycleJourney(report, {
          cliBin: artifacts.cliBin,
          installDir,
          consolePort: String(ports.consolePort),
        });
        report.record(
          "registry_lifecycle_journey",
          "Registry lifecycle journey",
          "PASS",
        );
      }

      if (groups.has("upgrade")) {
        const upgradeDir = await mkdtemp(
          path.join(os.tmpdir(), "osva-m16-upgrade-"),
        );
        try {
          await runM16UpgradeJourney(report, {
            cliBin: artifacts.cliBin,
            installDir: upgradeDir,
            priorImageRef: artifacts.priorImageRef,
            targetImageRef: artifacts.imageRef,
            targetPlatformVersion: artifacts.target.productVersion,
            webPort: ports.webPort + 10,
            mcpPort: ports.mcpPort + 10,
            useLocalUpgradeImage: artifacts.source === "local-pack",
          });
          report.record(
            "registry_upgrade_journey",
            "Registry upgrade journey",
            "PASS",
          );
        } finally {
          await teardown(upgradeDir).catch(() => {});
        }
      }
    } finally {
      await teardown(installDir).catch((error) => {
        console.error(
          redactSecrets(error instanceof Error ? error.message : String(error)),
        );
      });
      await artifacts.dispose().catch(() => {});
    }
  } catch (error) {
    report.record("fatal", "M16 registry acceptance", "FAIL", {
      detail: redactSecrets(
        error instanceof Error ? error.message : String(error),
      ),
    });
    console.error(
      redactSecrets(error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  }

  console.log(JSON.stringify(report.summary(), null, 2));
  report.assertAllPass();
}

void main();
