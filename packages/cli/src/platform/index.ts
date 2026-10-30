import { writeStdout } from "../stdout.js";
import { ComposeExecError } from "../setup/compose-exec.js";
import { printError } from "../output.js";
import {
  formatLifecycleHuman,
  formatLifecycleJson,
  formatPlatformDoctorHuman,
  formatPlatformDoctorJson,
  formatPlatformStatusHuman,
  formatPlatformStatusJson,
} from "./format.js";
import { runPlatformDoctor, platformDoctorExitCode } from "./doctor.js";
import {
  runPlatformRestart,
  runPlatformStart,
  runPlatformStop,
} from "./lifecycle.js";
import { parsePlatformLogsOptions, runPlatformLogs } from "./logs.js";
import { resolveInstallationForLifecycle } from "./resolve-installation.js";
import { collectPlatformStatus } from "./status.js";
import { PlatformCommandError } from "./types.js";
import type { ProbeSpawnFn } from "../setup/probe-spawn.js";
import { parsePlatformUpgradeOptions } from "./upgrade/options.js";
import {
  PlatformUpgradeDryRunReport,
  runPlatformUpgrade,
} from "./upgrade/run-upgrade.js";

export type PlatformCommandDependencies = {
  readonly spawn?: ProbeSpawnFn;
  readonly fetch?: typeof fetch;
  readonly processEnv?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
};

export async function runPlatformCommand(
  subcommand: readonly string[],
  flags: Readonly<Record<string, string | boolean>>,
  deps: PlatformCommandDependencies = {},
): Promise<number> {
  const processEnv = deps.processEnv ?? process.env;
  const json = flags.json === true;

  if (subcommand.length === 0 || subcommand[0] === "help") {
    printPlatformHelp();
    return subcommand.length === 0 ? 1 : 0;
  }

  const action = subcommand[0];
  try {
    if (action === "status") {
      const installation = await resolveInstallationForLifecycle(
        flags,
        processEnv,
        deps.platform,
      );
      const report = await collectPlatformStatus(installation, {
        fetch: deps.fetch,
        spawn: deps.spawn,
      });
      await writeStdout(
        json
          ? formatPlatformStatusJson(report)
          : formatPlatformStatusHuman(report),
      );
      return report.platformReady && report.problems.length === 0 ? 0 : 1;
    }

    if (action === "start") {
      const installation = await resolveInstallationForLifecycle(
        flags,
        processEnv,
        deps.platform,
      );
      const result = await runPlatformStart(installation, {
        spawn: deps.spawn,
        fetch: deps.fetch,
      });
      await writeStdout(
        json ? formatLifecycleJson(result) : formatLifecycleHuman(result),
      );
      return 0;
    }

    if (action === "stop") {
      const installation = await resolveInstallationForLifecycle(
        flags,
        processEnv,
        deps.platform,
      );
      const result = await runPlatformStop(installation, { spawn: deps.spawn });
      await writeStdout(
        json ? formatLifecycleJson(result) : formatLifecycleHuman(result),
      );
      return 0;
    }

    if (action === "restart") {
      const installation = await resolveInstallationForLifecycle(
        flags,
        processEnv,
        deps.platform,
      );
      const result = await runPlatformRestart(installation, {
        spawn: deps.spawn,
        fetch: deps.fetch,
      });
      await writeStdout(
        json ? formatLifecycleJson(result) : formatLifecycleHuman(result),
      );
      return 0;
    }

    if (action === "logs") {
      const installation = await resolveInstallationForLifecycle(
        flags,
        processEnv,
        deps.platform,
      );
      const logOptions = parsePlatformLogsOptions(flags);
      return await runPlatformLogs(installation, logOptions);
    }

    if (action === "upgrade") {
      const installation = await resolveInstallationForLifecycle(
        flags,
        processEnv,
        deps.platform,
      );
      const upgradeOptions = parsePlatformUpgradeOptions(flags);
      try {
        const result = await runPlatformUpgrade(installation, upgradeOptions, {
          spawn: deps.spawn,
          fetch: deps.fetch,
          processEnv,
        });
        await writeStdout(
          json ? `${JSON.stringify(result, null, 2)}\n` : `${result.message}\n`,
        );
        return 0;
      } catch (error) {
        if (error instanceof PlatformUpgradeDryRunReport) {
          await writeStdout(error.formatted);
          return error.report.blockingIssues.length > 0 ? 1 : 0;
        }
        throw error;
      }
    }

    if (action === "doctor") {
      const report = await runPlatformDoctor(flags, processEnv, deps);
      await writeStdout(
        json
          ? formatPlatformDoctorJson(report)
          : formatPlatformDoctorHuman(report),
      );
      return platformDoctorExitCode(report);
    }

    printError(`Unknown platform command: ${subcommand.join(" ")}`);
    printPlatformHelp();
    return 1;
  } catch (error) {
    return mapPlatformError(error, json);
  }
}

function mapPlatformError(error: unknown, json: boolean): number {
  if (error instanceof PlatformCommandError) {
    if (json) {
      void writeStdout(
        `${JSON.stringify({ error: { code: error.code, message: error.message } }, null, 2)}\n`,
      );
    } else {
      printError(error.message);
    }
    return error.code === "usage" ? 1 : 1;
  }
  if (error instanceof ComposeExecError) {
    const message = error.message;
    if (json) {
      void writeStdout(
        `${JSON.stringify({ error: { code: error.code, message } }, null, 2)}\n`,
      );
    } else {
      printError(message);
    }
    return 1;
  }
  if (error instanceof Error) {
    printError(error.message);
    return 1;
  }
  printError("Platform command failed.");
  return 1;
}

function printPlatformHelp(): void {
  process.stdout.write(`OSVA platform lifecycle

Usage:
  osva platform <command> [--install-dir PATH] [--json]

Commands:
  status    Show installation, service, and readiness overview
  start     Start an existing installation (no image pull or migration)
  stop      Gracefully stop services (preserves volumes and secrets)
  restart   Restart services in place (no image pull or migration)
  logs      Show recent service logs [--service NAME] [--tail N] [--follow]
  doctor    Diagnose Docker, installation, services, API, and Console health
  upgrade   Explicit platform upgrade (--to VERSION [--dry-run] [--backup-confirmed] [--yes])

Install OSVA with \`osva setup\`. Lifecycle commands never create a new installation.
\`platform upgrade\` requires --dry-run review, then --backup-confirmed and --yes to execute.
`);
}
