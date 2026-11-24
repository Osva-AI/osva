import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { readRepositoryMigrationHead } from "../../../release/lib/read-migration-head.mjs";
import { redactSecrets } from "../../m16-2d/redact.mjs";
import { runCli } from "../../m16-shared/cli-runner.mjs";
import { bootstrapPlatform110Install } from "./bootstrap-platform-110.mjs";
import { bootstrapPlatform111Install } from "./bootstrap-platform-111.mjs";

/** @param {string} dryRunOutput */
export function migrationRequiredFromDryRun(dryRunOutput) {
  const match = dryRunOutput.match(/Migration required:\s*(yes|no)/i);
  return match?.[1]?.toLowerCase() === "yes";
}

/**
 * @param {import("../../m16-2d/report.mjs").AcceptanceReport} report
 * @param {object} input
 * @param {string} input.cliBin
 * @param {string} input.installDir
 * @param {string} input.priorImageRef
 * @param {"1.1.0" | "1.1.1"} input.priorPlatformVersion
 * @param {string} input.targetImageRef
 * @param {string} input.targetPlatformVersion
 * @param {number} input.webPort
 * @param {number} input.mcpPort
 * @param {number} [input.consolePort]
 * @param {boolean} [input.useLocalUpgradeImage]
 */
export async function runM16UpgradeJourney(report, input) {
  /** @type {NodeJS.ProcessEnv} */
  const upgradeEnv = {};
  if (input.useLocalUpgradeImage) {
    upgradeEnv.OSVA_UPGRADE_LOCAL_IMAGE = input.targetImageRef;
  }
  const priorLabel = input.priorPlatformVersion;
  if (input.priorPlatformVersion === "1.1.1") {
    await bootstrapPlatform111Install({
      installDir: input.installDir,
      imageRef: input.priorImageRef,
      webPort: input.webPort,
      mcpPort: input.mcpPort,
      consolePort:
        input.consolePort ??
        (input.webPort + 2 <= 65535 ? input.webPort + 2 : input.webPort),
    });
  } else {
    await bootstrapPlatform110Install({
      installDir: input.installDir,
      imageRef: input.priorImageRef,
      webPort: input.webPort,
      mcpPort: input.mcpPort,
    });
  }

  const envFile = path.join(input.installDir, ".env");
  const configCheck = spawnSync(
    "docker",
    [
      "compose",
      "--project-directory",
      input.installDir,
      "--env-file",
      envFile,
      "config",
    ],
    { encoding: "utf8" },
  );
  report.record(
    "upgrade_bootstrap_compose_config",
    `Prior ${priorLabel} compose config validates`,
    configCheck.status === 0 ? "PASS" : "FAIL",
    {
      detail:
        configCheck.status === 0
          ? undefined
          : redactSecrets(configCheck.stderr || configCheck.stdout).slice(
              0,
              300,
            ),
    },
  );
  if (configCheck.status !== 0) {
    return;
  }

  const up = spawnSync(
    "docker",
    [
      "compose",
      "--project-directory",
      input.installDir,
      "--env-file",
      envFile,
      "up",
      "-d",
      "postgres",
      "valkey",
    ],
    { encoding: "utf8", stdio: "inherit" },
  );
  report.record(
    "upgrade_bootstrap_compose",
    `Prior ${priorLabel} compose stack starts`,
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
  const dryRunText = redactSecrets(dryRun.stderr || dryRun.stdout || "");
  report.record(
    "upgrade_dry_run",
    "platform upgrade dry-run",
    dryRun.status === 0 ? "PASS" : "FAIL",
    { detail: dryRunText.slice(0, 300) },
  );
  if (dryRun.status !== 0) {
    return;
  }

  const migrationRequired = migrationRequiredFromDryRun(dryRunText);
  if (migrationRequired) {
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
      "Upgrade refuses without backup attestation when migrations are required",
      withoutBackup.status !== 0 ? "PASS" : "FAIL",
    );
  } else {
    report.record(
      "upgrade_requires_backup",
      "Upgrade backup attestation policy",
      "PASS",
      {
        detail:
          "No migration on this upgrade path; backup attestation not required per upgrade catalog.",
      },
    );
  }

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

  if (input.targetPlatformVersion === "1.2.0") {
    const expectedHead = readRepositoryMigrationHead();
    const envRaw = await readFile(path.join(input.installDir, ".env"), "utf8");
    const password =
      envRaw.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1]?.trim() ?? "";
    const composeProject =
      envRaw.match(/^COMPOSE_PROJECT_NAME=(.+)$/m)?.[1]?.trim() ?? "";
    const image = envRaw.match(/^OSVA_IMAGE=(.+)$/m)?.[1]?.trim() ?? "";
    const statusOutput = spawnSync(
      "docker",
      [
        "compose",
        "--project-directory",
        input.installDir,
        "--env-file",
        path.join(input.installDir, ".env"),
        "run",
        "--rm",
        "--no-deps",
        "--entrypoint",
        "node",
        "migrate",
        "/app/packages/db/dist/migrations-status-cli.js",
        `postgres://osva:${password}@postgres:5432/osva`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          COMPOSE_PROJECT_NAME: composeProject,
          POSTGRES_PASSWORD: password,
          OSVA_IMAGE: image,
        },
      },
    );
    const migrationText = redactSecrets(
      statusOutput.stdout || statusOutput.stderr || "",
    );
    const migrationOk =
      migrationText.includes(`database head: ${expectedHead}`) &&
      migrationText.includes(`repository head: ${expectedHead}`) &&
      migrationText.includes("pending migrations: (none)");
    report.record(
      "upgrade_migration_head",
      `Database migration head is ${expectedHead} after upgrade`,
      migrationOk ? "PASS" : "FAIL",
      { detail: migrationText.slice(0, 500) },
    );
  }
}
