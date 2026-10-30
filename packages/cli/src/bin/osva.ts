#!/usr/bin/env node

import { OsvaClient } from "@osva-ai/sdk";

import { runCommand } from "../commands/index.js";
import { loadCliConfig, parseCliArgs } from "../config.js";
import { runDoctorCommand } from "../doctor/index.js";
import { runSetupCommand } from "../setup/index.js";
import { exitCli } from "../exit.js";
import { runInitCommand } from "../init/index.js";
import { printError } from "../output.js";
import {
  runDeployCommand,
  runRunCommand,
  runStatusCommand,
} from "../project/index.js";
import { runValidateCommand } from "../validate/index.js";

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  const jsonOutput = parsed.flags.json === true;
  const helpCommand =
    parsed.command.length === 0 ||
    parsed.command[0] === "help" ||
    parsed.command[0] === "--help";
  const versionCommand = parsed.command[0] === "version";
  const doctorCommand = parsed.command[0] === "doctor";
  const setupCommand = parsed.command[0] === "setup";
  const initCommand = parsed.command[0] === "init";
  const validateCommand = parsed.command[0] === "validate";
  const deployCommand = parsed.command[0] === "deploy";
  const runAgentCommand = parsed.command[0] === "run";
  const statusCommand = parsed.command[0] === "status";

  if (initCommand) {
    try {
      const exitCode = await runInitCommand(parsed.command, parsed.flags);
      await exitCli(exitCode);
    } catch (error) {
      printError(error instanceof Error ? error.message : "Init failed.");
      await exitCli(1);
    }
    return;
  }

  if (validateCommand) {
    try {
      const exitCode = await runValidateCommand(parsed.flags);
      await exitCli(exitCode);
    } catch (error) {
      printError(error instanceof Error ? error.message : "Validate failed.");
      await exitCli(1);
    }
    return;
  }

  if (setupCommand) {
    try {
      const exitCode = await runSetupCommand(parsed.flags);
      await exitCli(exitCode);
    } catch (error) {
      printError(error instanceof Error ? error.message : "Setup failed.");
      await exitCli(1);
    }
    return;
  }

  if (doctorCommand) {
    try {
      const exitCode = await runDoctorCommand(parsed.flags);
      await exitCli(exitCode);
    } catch (error) {
      printError(error instanceof Error ? error.message : "Doctor failed.");
      await exitCli(1);
    }
    return;
  }

  if (deployCommand || runAgentCommand || statusCommand) {
    let config;
    try {
      config = loadCliConfig(parsed.flags);
    } catch (error) {
      printError(
        error instanceof Error ? error.message : "Invalid configuration.",
      );
      await exitCli(1);
      return;
    }

    try {
      const exitCode = deployCommand
        ? await runDeployCommand(config, parsed.flags)
        : runAgentCommand
          ? await runRunCommand(config, parsed.flags)
          : await runStatusCommand(config, parsed.flags);
      await exitCli(exitCode);
    } catch (error) {
      printError(
        error instanceof Error
          ? error.message
          : deployCommand
            ? "Deploy failed."
            : runAgentCommand
              ? "Run failed."
              : "Status failed.",
      );
      await exitCli(1);
    }
    return;
  }

  if (helpCommand || versionCommand) {
    const exitCode = await runCommand(
      new OsvaClient({
        baseUrl: "http://127.0.0.1:9",
        apiKey: "osva_ak_test.placeholder",
      }),
      {
        baseUrl: "http://127.0.0.1:9",
        apiKey: "osva_ak_test.placeholder",
        json: jsonOutput,
      },
      parsed.command.length === 0
        ? ["help"]
        : versionCommand
          ? ["version"]
          : parsed.command,
      parsed.flags,
    );
    await exitCli(exitCode);
    return;
  }

  let config;
  try {
    config = loadCliConfig(parsed.flags);
  } catch (error) {
    printError(
      error instanceof Error ? error.message : "Invalid configuration.",
    );
    await exitCli(1);
    return;
  }

  const client = new OsvaClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  });

  const exitCode = await runCommand(
    client,
    config,
    parsed.command,
    parsed.flags,
  );
  await exitCli(exitCode);
}

void main().catch(async (error) => {
  printError(
    error instanceof Error ? error.message : "Unexpected CLI failure.",
  );
  await exitCli(1);
});
