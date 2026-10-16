import { writeStdout } from "../stdout.js";
import type { CliConfig } from "../config.js";
import { printError } from "../output.js";
import {
  formatDeployHuman,
  formatDeployJson,
  formatRunHuman,
  formatRunJson,
  formatStatusHuman,
  formatStatusJson,
} from "./format.js";
import { runDeployPipeline } from "./run-deploy.js";
import { runRunPipeline } from "./run-run.js";
import { runStatusPipeline } from "./run-status.js";
import { mapProjectSdkError } from "./sdk-error.js";

export async function runDeployCommand(
  config: CliConfig,
  flags: Readonly<Record<string, string | boolean>>,
): Promise<number> {
  let result;
  try {
    result = await runDeployPipeline({ config, flags });
  } catch (error) {
    const mapped = mapProjectSdkError({ error, json: config.json });
    if (mapped !== null) {
      if (mapped.stdout !== undefined) {
        await writeStdout(mapped.stdout);
      }
      if (mapped.message !== undefined) {
        printError(mapped.message);
      }
      return mapped.exitCode;
    }
    throw error;
  }
  if (!result.ok) {
    if (result.validateStdout !== undefined) {
      await writeStdout(result.validateStdout);
      return result.exitCode;
    }
    if (result.message !== undefined) {
      printError(result.message);
    }
    return result.exitCode;
  }

  await writeStdout(
    config.json
      ? formatDeployJson(result.payload)
      : formatDeployHuman(result.payload),
  );
  return 0;
}

export async function runRunCommand(
  config: CliConfig,
  flags: Readonly<Record<string, string | boolean>>,
): Promise<number> {
  let result;
  try {
    result = await runRunPipeline({ config, flags });
  } catch (error) {
    const mapped = mapProjectSdkError({ error, json: config.json });
    if (mapped !== null) {
      if (mapped.stdout !== undefined) {
        await writeStdout(mapped.stdout);
      }
      if (mapped.message !== undefined) {
        printError(mapped.message);
      }
      return mapped.exitCode;
    }
    throw error;
  }
  if (!result.ok) {
    if (result.validateStdout !== undefined) {
      await writeStdout(result.validateStdout);
      return result.exitCode;
    }
    if (result.message !== undefined) {
      printError(result.message);
    }
    return result.exitCode;
  }

  await writeStdout(
    config.json
      ? formatRunJson(result.payload)
      : formatRunHuman(result.payload),
  );
  return result.waited && result.payload.status !== "SUCCEEDED" ? 1 : 0;
}

export async function runStatusCommand(
  config: CliConfig,
  flags: Readonly<Record<string, string | boolean>>,
): Promise<number> {
  let result;
  try {
    result = await runStatusPipeline({ config, flags });
  } catch (error) {
    const mapped = mapProjectSdkError({ error, json: config.json });
    if (mapped !== null) {
      if (mapped.stdout !== undefined) {
        await writeStdout(mapped.stdout);
      }
      if (mapped.message !== undefined) {
        printError(mapped.message);
      }
      return mapped.exitCode;
    }
    throw error;
  }
  if (!result.ok) {
    printError(result.message);
    return result.exitCode;
  }

  await writeStdout(
    config.json
      ? formatStatusJson(result.payload)
      : formatStatusHuman(result.payload),
  );
  return 0;
}
