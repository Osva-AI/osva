import { writeStdout } from "../stdout.js";
import { formatSetupHuman, formatSetupJson } from "./format.js";
import { readSetupOptions } from "./read-options.js";
import { runSetupProvision } from "./run-provision.js";
import {
  runSetupPipeline,
  setupExitCode,
  type SetupProbeDependencies,
} from "./run-setup.js";
import { mergeSetupReport } from "./setup-report.js";

export type { SetupOptions } from "./read-options.js";
export type { SetupProbeDependencies } from "./run-setup.js";
export type { SetupReport } from "./setup-report.js";
export {
  DEFAULT_SETUP_SUBPROCESS_TIMEOUT_MS,
  runSetupPipeline,
  setupExitCode,
} from "./run-setup.js";
export { parsePortNumber, readSetupOptions } from "./read-options.js";
export { runSetupProvision } from "./run-provision.js";
export {
  buildInstallEnvValues,
  detectShellEnvConflicts,
  parseDotEnv,
  renderInstallEnvFile,
} from "./env-file.js";
export { materializeInstallation } from "./materialize-install.js";
export {
  composeBaseArgs,
  composeCommandIncludesDestructiveVolumeRemoval,
} from "./compose-exec.js";
export {
  assertPinnedImageRef,
  loadComposeDistribution,
} from "./distribution.js";
export { defaultInstallDir, resolveInstallDir } from "./install-path.js";

export interface SetupCommandDependencies extends SetupProbeDependencies {
  readonly processEnv?: NodeJS.ProcessEnv;
}

export async function runSetupCommand(
  flags: Readonly<Record<string, string | boolean>>,
  processEnv: NodeJS.ProcessEnv = process.env,
  deps: SetupCommandDependencies = {},
): Promise<number> {
  const options = readSetupOptions(flags, processEnv, deps.platform);
  const preflight = await runSetupPipeline(options, {
    ...deps,
    cwdForDisk: options.installDir,
  });
  const json = flags.json === true;

  if (preflight.result === "fail" || options.preflightOnly) {
    const report = mergeSetupReport({
      preflight,
      installDir: options.installDir,
      phase: "preflight",
    });
    await writeStdout(
      json ? formatSetupJson(report) : formatSetupHuman(report),
    );
    return setupExitCode(report);
  }

  const provision = await runSetupProvision(options, {
    spawn: deps.spawn,
    processEnv,
  });
  const report = mergeSetupReport({
    preflight,
    provisionChecks: provision.checks,
    installDir: options.installDir,
    phase: "provision",
    setupTokenForOperator: provision.setupTokenForOperator,
  });
  await writeStdout(json ? formatSetupJson(report) : formatSetupHuman(report));
  return setupExitCode(report);
}
