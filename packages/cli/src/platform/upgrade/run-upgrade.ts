import { readFile } from "node:fs/promises";
import path from "node:path";

import { redactSecrets } from "../../doctor/redact.js";
import {
  assertComposeSuccess,
  buildComposeSpawnEnv,
  composeCommandIncludesDestructiveVolumeRemoval,
  runComposeCommand,
} from "../../setup/compose-exec.js";
import { writeFileAtomic } from "../../setup/atomic-write.js";
import { renderInstallEnvFile } from "../../setup/env-file.js";
import {
  INSTALLATION_MARKER_RELATIVE,
  renderInstallationMarker,
} from "../../setup/installation-state.js";
import {
  defaultProbeSpawn,
  type ProbeSpawnFn,
} from "../../setup/probe-spawn.js";
import { CLI_VERSION } from "../../version.js";
import { installEnvValuesFromMap } from "../resolve-installation.js";
import { probeInstallationReadiness } from "../readiness.js";
import { PLATFORM_APPLICATION_SERVICES } from "../services.js";
import { PlatformCommandError, type ResolvedInstallation } from "../types.js";
import { COMPOSE_LIFECYCLE_TIMEOUT_MS } from "../lifecycle.js";
import {
  backupRequirementsText,
  requiresBackupAttestation,
} from "./backup-policy.js";
import {
  formatUpgradeDryRunHuman,
  runUpgradePreflight,
  type UpgradePreflightReport,
} from "./preflight.js";
import type { ResolvedUpgradeTarget } from "./catalog.js";
import {
  acquireUpgradeLock,
  clearUpgradeState,
  releaseUpgradeLock,
  writeUpgradeState,
  type UpgradePhase,
  type UpgradeState,
} from "./state.js";
import type { PlatformUpgradeOptions } from "./options.js";

export const COMPOSE_UPGRADE_PULL_TIMEOUT_MS = 900_000;
const INTEGRITY_CLI_IMAGE_PATH =
  "/app/packages/db/dist/migrations-integrity-cli.js";

export interface UpgradeResult {
  readonly fromPlatformVersion: string;
  readonly toPlatformVersion: string;
  readonly imageRef: string;
  readonly message: string;
}

export async function runPlatformUpgrade(
  installation: ResolvedInstallation,
  options: PlatformUpgradeOptions,
  deps: {
    readonly spawn?: ProbeSpawnFn;
    readonly fetch?: typeof fetch;
    readonly processEnv?: NodeJS.ProcessEnv;
  } = {},
): Promise<UpgradeResult> {
  const processEnv = deps.processEnv ?? process.env;
  const report = await runUpgradePreflight({
    installation,
    toPlatformVersion: options.toPlatformVersion,
    processEnv,
    spawn: deps.spawn,
    fetch: deps.fetch,
  });

  if (report.blockingIssues.length > 0) {
    throw new PlatformCommandError(
      "installation_invalid",
      report.blockingIssues.join(" "),
    );
  }

  if (options.dryRun) {
    throw new PlatformUpgradeDryRunReport(
      formatUpgradeDryRunHuman(report),
      report,
    );
  }
  if (report.target === undefined) {
    throw new PlatformCommandError(
      "installation_invalid",
      report.blockingIssues.join(" "),
    );
  }
  const target = report.target;

  if (!options.authorizeExecute) {
    throw new PlatformCommandError(
      "usage",
      "Refusing to upgrade without --yes. Run with --dry-run first to review the plan.",
    );
  }
  if (
    requiresBackupAttestation(report.migrationRequired) &&
    !options.backupConfirmed
  ) {
    throw new PlatformCommandError(
      "usage",
      `Refusing upgrade without --backup-confirmed.\n\n${backupRequirementsText()}`,
    );
  }

  await acquireUpgradeLock(installation.installDir);
  const startedAt = new Date().toISOString();
  let state: UpgradeState = {
    schemaVersion: 1,
    phase: "locked",
    fromPlatformVersion: report.currentPlatformVersion,
    toPlatformVersion: report.targetPlatformVersion,
    fromImageRef: report.currentImageRef,
    targetImageRef: report.targetImageRef,
    startedAt,
    updatedAt: startedAt,
    migrationRequired: report.migrationRequired,
  };

  try {
    await persistState(installation.installDir, state);

    state = await advance(state, "pulling_image", installation.installDir);
    pullTargetImage(target.imageRef, deps.spawn);

    state = await advance(
      state,
      "prepared_configuration",
      installation.installDir,
    );
    await prepareInstallationConfiguration(installation, target);

    state = await advance(
      state,
      "stopped_applications",
      installation.installDir,
    );
    stopApplicationServices(installation, deps.spawn);

    if (report.migrationRequired) {
      state = await advance(state, "migrating", installation.installDir);
      try {
        runMigrationJob(installation, deps.spawn);
        verifyMigrationIntegrity(installation, deps.spawn);
      } catch (error) {
        state = await advance(
          state,
          "migration_failed",
          installation.installDir,
          error,
        );
        throw migrationFailure(error);
      }
    }

    state = await advance(
      state,
      "starting_applications",
      installation.installDir,
    );
    startApplicationServices(installation, deps.spawn);

    state = await advance(
      state,
      "validating_readiness",
      installation.installDir,
    );
    const readiness = await probeInstallationReadiness(
      {
        ...installation,
        envValues: {
          ...installation.envValues,
          OSVA_IMAGE: target.imageRef,
        },
      },
      deps.fetch ?? fetch,
    );
    if (!readiness.apiReadyOk || !readiness.consoleReady) {
      throw new PlatformCommandError(
        "platform_not_ready",
        "Upgrade rolled out the target image but readiness checks failed. The database schema may have migrated; do not downgrade the application without operator review. Inspect logs and docs/operations/UPGRADE.md.",
      );
    }

    await updateInstallationMarker(installation, target);
    state = await advance(state, "completed", installation.installDir);
    await clearUpgradeState(installation.installDir);

    return {
      fromPlatformVersion: report.currentPlatformVersion,
      toPlatformVersion: report.targetPlatformVersion,
      imageRef: target.imageRef,
      message: `Upgraded OSVA platform from ${report.currentPlatformVersion} to ${report.targetPlatformVersion}.`,
    };
  } catch (error) {
    if (
      state.phase !== "completed" &&
      state.phase !== "migration_failed" &&
      state.phase !== "failed"
    ) {
      state = await advance(state, "failed", installation.installDir, error);
    }
    throw error;
  } finally {
    await releaseUpgradeLock(installation.installDir);
  }
}

export class PlatformUpgradeDryRunReport extends Error {
  readonly formatted: string;
  readonly report: UpgradePreflightReport;

  constructor(formatted: string, report: UpgradePreflightReport) {
    super("dry-run");
    this.formatted = formatted;
    this.report = report;
  }
}

async function persistState(
  installDir: string,
  state: UpgradeState,
): Promise<void> {
  await writeUpgradeState(installDir, state);
}

async function advance(
  state: UpgradeState,
  phase: UpgradePhase,
  installDir: string,
  error?: unknown,
): Promise<UpgradeState> {
  const next: UpgradeState = {
    ...state,
    phase,
    updatedAt: new Date().toISOString(),
    ...(error === undefined
      ? {}
      : {
          lastError: redactSecrets(
            error instanceof Error ? error.message : String(error),
          ),
        }),
  };
  await writeUpgradeState(installDir, next);
  return next;
}

function pullTargetImage(
  imageRef: string,
  spawn: ProbeSpawnFn | undefined,
): void {
  const run = spawn ?? defaultProbeSpawn;
  const pull = run(
    "docker",
    ["pull", imageRef],
    COMPOSE_UPGRADE_PULL_TIMEOUT_MS,
  );
  if (pull.status !== 0) {
    throw new PlatformCommandError(
      "compose_failed",
      redactSecrets(
        pull.stderr.trim() ||
          pull.stdout.trim() ||
          `Failed to pull ${imageRef}.`,
      ),
    );
  }
}

async function prepareInstallationConfiguration(
  installation: ResolvedInstallation,
  target: ResolvedUpgradeTarget,
): Promise<void> {
  const envMap = new Map(Object.entries(installation.envValues));
  envMap.set("OSVA_IMAGE", target.imageRef);
  const values = installEnvValuesFromMap(envMap);
  await writeFileAtomic(installation.envPath, renderInstallEnvFile(values), {
    restrictPermissions: true,
  });
  if (target.path.composeTemplateUpdate) {
    await writeFileAtomic(installation.composePath, target.composeYaml);
  }
}

function stopApplicationServices(
  installation: ResolvedInstallation,
  spawn: ProbeSpawnFn | undefined,
): void {
  const services = [...PLATFORM_APPLICATION_SERVICES].reverse();
  const args = ["stop", ...services];
  assertSafeArgs(args);
  const result = runComposeCommand(installation.execCtx, args, {
    spawn,
    timeoutMs: COMPOSE_LIFECYCLE_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(installation.execCtx),
  });
  assertComposeSuccess(result, "Stopping application services for upgrade");
}

function runMigrationJob(
  installation: ResolvedInstallation,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = ["up", "--no-build", "--wait", "migrate"];
  assertSafeArgs(args);
  const result = runComposeCommand(installation.execCtx, args, {
    spawn,
    timeoutMs: COMPOSE_LIFECYCLE_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(installation.execCtx),
  });
  assertComposeSuccess(result, "Database migration job");
}

function verifyMigrationIntegrity(
  installation: ResolvedInstallation,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = [
    "run",
    "--rm",
    "-T",
    "--no-deps",
    "--entrypoint",
    "node",
    "web",
    INTEGRITY_CLI_IMAGE_PATH,
  ];
  assertSafeArgs(args);
  const result = runComposeCommand(installation.execCtx, args, {
    spawn,
    timeoutMs: COMPOSE_LIFECYCLE_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(installation.execCtx),
  });
  if (result.status !== 0) {
    throw new PlatformCommandError(
      "platform_not_ready",
      redactSecrets(
        result.stderr.trim() ||
          result.stdout.trim() ||
          "Migration integrity probe failed.",
      ),
    );
  }
  const output = result.stdout.trim();
  if (
    output.includes("schema_mismatch") ||
    output.includes("schema_ahead") ||
    output.includes("database_inaccessible")
  ) {
    throw new PlatformCommandError(
      "platform_not_ready",
      "Migration integrity probe reported schema mismatch. Follow docs/operations/UPGRADE.md before restarting applications.",
    );
  }
}

function startApplicationServices(
  installation: ResolvedInstallation,
  spawn: ProbeSpawnFn | undefined,
): void {
  const args = [
    "up",
    "-d",
    "--no-build",
    "--pull",
    "never",
    "--wait",
    ...PLATFORM_APPLICATION_SERVICES,
  ];
  assertSafeArgs(args);
  const result = runComposeCommand(installation.execCtx, args, {
    spawn,
    timeoutMs: COMPOSE_LIFECYCLE_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(installation.execCtx),
  });
  assertComposeSuccess(result, "Starting upgraded application services");
}

async function updateInstallationMarker(
  installation: ResolvedInstallation,
  target: ResolvedUpgradeTarget,
): Promise<void> {
  const markerPath = path.join(
    installation.installDir,
    INSTALLATION_MARKER_RELATIVE,
  );
  const raw = await readFile(markerPath, "utf8");
  const existing = JSON.parse(raw) as NonNullable<
    Parameters<typeof renderInstallationMarker>[0]["existing"]
  >;
  const marker = renderInstallationMarker({
    platformVersion: target.platformVersion,
    imageRef: target.imageRef,
    cliVersion: CLI_VERSION,
    installDir: installation.installDir,
    composeProjectName: installation.envValues.COMPOSE_PROJECT_NAME,
    existing,
  });
  await writeFileAtomic(markerPath, `${JSON.stringify(marker, null, 2)}\n`, {
    restrictPermissions: true,
  });
}

function assertSafeArgs(args: readonly string[]): void {
  if (composeCommandIncludesDestructiveVolumeRemoval(args)) {
    throw new Error("Refusing destructive compose operation during upgrade.");
  }
}

function migrationFailure(error: unknown): PlatformCommandError {
  return new PlatformCommandError(
    "platform_not_ready",
    error instanceof PlatformCommandError
      ? error.message
      : "Database migration failed during upgrade. Application services remain stopped. Schema may be partially migrated — see docs/operations/UPGRADE.md.",
  );
}
