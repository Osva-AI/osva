#!/usr/bin/env node

import { OsvaClient } from "@osva/sdk";

import { runCommand } from "../commands/index.js";
import { loadCliConfig, parseCliArgs } from "../config.js";
import { printError } from "../output.js";

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  const helpCommand =
    parsed.command.length === 0 ||
    parsed.command[0] === "help" ||
    parsed.command[0] === "--help";

  if (helpCommand) {
    const exitCode = await runCommand(
      new OsvaClient({
        baseUrl: "http://127.0.0.1:9",
        apiKey: "osva_ak_test.placeholder",
      }),
      {
        baseUrl: "http://127.0.0.1:9",
        apiKey: "osva_ak_test.placeholder",
        json: false,
      },
      parsed.command.length === 0 ? ["help"] : parsed.command,
      parsed.flags,
    );
    process.exit(exitCode);
    return;
  }

  let config;
  try {
    config = loadCliConfig(parsed.flags);
  } catch (error) {
    printError(
      error instanceof Error ? error.message : "Invalid configuration.",
    );
    process.exit(1);
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
  process.exit(exitCode);
}

void main();
