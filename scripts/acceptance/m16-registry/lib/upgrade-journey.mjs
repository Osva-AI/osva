import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { redactSecrets } from "../../m16-2d/redact.mjs";
import { runCli } from "../../m16-shared/cli-runner.mjs";
import { bootstrapPlatform110Install } from "./bootstrap-platform-110.mjs";

/**
 * @param {import("../../m16-2d/report.mjs").AcceptanceReport} report
 * @param {object} input
 * @param {string} input.cliBin
 * @param {string} input.installDir
 * @param {string} input.priorImageRef
 * @param {string} input.targetImageRef
 * @param {string} input.targetPlatformVersion
 * @param {number} input.webPort
 * @param {number} input.mcpPort
 * @param {boolean} [input.useLocalUpgradeImage]
 */
export async function runM16UpgradeJourney(report, input) {
  /** @type {NodeJS.ProcessEnv} */
  const upgradeEnv = {};
  if (input.useLocalUpgradeImage) {
    upgradeEnv.OSVA_UPGRADE_LOCAL_IMAGE = input.targetImageRef;
  }
  const composeProject = `osva-m16-upg-${Date.now()}`;
  await bootstrapPlatform110Install({
    installDir: input.installDir,
    imageRef: input.priorImageRef,
    webPort: input.webPort,
    mcpPort: input.mcpPort,
    composeProjectName: composeProject,
  });

  const up = spawnSync(
    "docker",
    [
      "compose",
      "--project-directory",
      input.installDir,
      "--env-file",
      path.join(input.installDir, ".env"),
      "up",
      "-d",
      "postgres",
      "valkey",
    ],
    { encoding: "utf8", stdio: "inherit" },
  );
  report.record(
    "upgrade_bootstrap_compose",
    "Legacy 1.1.0 compose stack starts",
    up.status === 0 ? "PASS" : "FAIL",
  );
  if (up.status !== 0) {
    return;
  }

  spawnSync(
    "docker",
    [
      "compose",
      "--project-directory",
      input.installDir,
      "--env-file",
      path.join(input.installDir, ".env"),
      "run",
      "--rm",
      "migrate",
    ],
    { stdio: "inherit" },
  );

  const markerBefore = JSON.parse(
    await readFile(
      path.join(input.installDir, ".osva", "installation.json"),
      "utf8",
    ),
  );
  const envBefore = await readFile(path.join(input.installDir, ".env"), "utf8");

  const dryRun = runCli(
    input.cliBin,
    [
      "platform",
      "upgrade",
      "--to",
      input.targetPlatformVersion,
      "--install-dir",
      input.installDir,
      "--dry-run",
    ],
    upgradeEnv,
  );
  report.record(
    "upgrade_dry_run",
    "platform upgrade dry-run",
    dryRun.status === 0 ? "PASS" : "FAIL",
    { detail: redactSecrets(dryRun.stderr || dryRun.stdout).slice(0, 300) },
  );

  const withoutBackup = runCli(
    input.cliBin,
    [
      "platform",
      "upgrade",
      "--to",
      input.targetPlatformVersion,
      "--install-dir",
      input.installDir,
      "--yes",
    ],
    upgradeEnv,
  );
  report.record(
    "upgrade_requires_backup",
    "Upgrade refuses without backup attestation",
    withoutBackup.status !== 0 ? "PASS" : "FAIL",
  );

  const execute = runCli(
    input.cliBin,
    [
      "platform",
      "upgrade",
      "--to",
      input.targetPlatformVersion,
      "--install-dir",
      input.installDir,
      "--backup-confirmed",
      "--yes",
    ],
    upgradeEnv,
  );
  report.record(
    "upgrade_execute",
    "platform upgrade with backup attestation",
    execute.status === 0 ? "PASS" : "FAIL",
    { detail: redactSecrets(execute.stderr || execute.stdout).slice(0, 400) },
  );

  const markerAfter = JSON.parse(
    await readFile(
      path.join(input.installDir, ".osva", "installation.json"),
      "utf8",
    ),
  );
  report.record(
    "upgrade_marker_version",
    "Installation marker platform version updated",
    markerAfter.platformVersion === input.targetPlatformVersion
      ? "PASS"
      : "FAIL",
    {
      detail: `${markerBefore.platformVersion} → ${markerAfter.platformVersion}`,
    },
  );

  const envAfter = await readFile(path.join(input.installDir, ".env"), "utf8");
  const beforeSecrets = envBefore.match(/POSTGRES_PASSWORD=(.+)/)?.[1];
  const afterSecrets = envAfter.match(/POSTGRES_PASSWORD=(.+)/)?.[1];
  report.record(
    "upgrade_secrets_preserved",
    "Upgrade preserves database credentials",
    beforeSecrets && beforeSecrets === afterSecrets ? "PASS" : "FAIL",
  );

  const status = runCli(input.cliBin, [
    "platform",
    "status",
    "--install-dir",
    input.installDir,
  ]);
  report.record(
    "upgrade_status_after",
    "platform status after upgrade",
    status.status === 0 ? "PASS" : "WARN",
  );
}
