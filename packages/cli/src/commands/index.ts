import type { JsonValue } from "@osva/contracts";
import type { OsvaClient } from "@osva/sdk";
import { OsvaApiError } from "@osva/sdk";

import type { CliConfig } from "../config.js";
import { printError, printResult } from "../output.js";

export async function runCommand(
  client: OsvaClient,
  config: CliConfig,
  command: readonly string[],
  flags: Readonly<Record<string, string | boolean>>,
): Promise<number> {
  if (command.length === 0) {
    printHelp();
    return command.length === 0 ? 1 : 0;
  }

  try {
    if (command[0] === "agents") {
      return await runAgents(client, config, command.slice(1));
    }
    if (command[0] === "runs") {
      return await runRuns(client, config, command.slice(1), flags);
    }
    if (command[0] === "workflows") {
      return await runWorkflows(client, config, command.slice(1), flags);
    }
    if (command[0] === "workflow-runs") {
      return await runWorkflowRuns(client, config, command.slice(1));
    }
    if (command[0] === "approvals") {
      return await runApprovals(client, config, command.slice(1), flags);
    }
    if (command[0] === "schedules") {
      return await runSchedules(client, config, command.slice(1));
    }
    if (command[0] === "version") {
      printResult({ version: "0.0.0" }, config.json);
      return 0;
    }
    if (command[0] === "help" || command[0] === "--help") {
      printHelp();
      return 0;
    }

    printError(`Unknown command: ${command.join(" ")}`);
    return 1;
  } catch (error) {
    if (error instanceof OsvaApiError) {
      if (config.json) {
        printResult(
          { error: { status: error.status, body: error.body } },
          true,
        );
      } else {
        printError(error.message);
      }
      return 1;
    }
    if (error instanceof Error) {
      printError(error.message);
      return 1;
    }
    printError("Command failed.");
    return 1;
  }
}

async function runAgents(
  client: OsvaClient,
  config: CliConfig,
  command: readonly string[],
): Promise<number> {
  if (command[0] === "list" && command.length === 1) {
    const result = await client.agents.list();
    printResult(result.agents, config.json);
    return 0;
  }
  if (command[0] === "get" && typeof command[1] === "string") {
    const result = await client.agents.get(command[1] as never);
    printResult(result, config.json);
    return 0;
  }
  printError("Usage: osva agents list | osva agents get <agentId>");
  return 1;
}

async function runRuns(
  client: OsvaClient,
  config: CliConfig,
  command: readonly string[],
  flags: Readonly<Record<string, string | boolean>>,
): Promise<number> {
  if (command[0] === "get" && typeof command[1] === "string") {
    const result = await client.runs.get(command[1] as never);
    printResult(result, config.json);
    return 0;
  }
  if (command[0] === "create" && command.length === 1) {
    const agentId = requireFlag(flags, "agent-id");
    const agentVersionId = requireFlag(flags, "agent-version-id");
    const input = parseJsonFlag(flags, "input", {});
    const result = await client.runs.create({
      agentId: agentId as never,
      agentVersionId: agentVersionId as never,
      input: input as JsonValue,
    });
    printResult(result, config.json);
    return 0;
  }
  printError(
    "Usage: osva runs get <runId> | osva runs create --agent-id ... --agent-version-id ... [--input '{}']",
  );
  return 1;
}

async function runWorkflows(
  client: OsvaClient,
  config: CliConfig,
  command: readonly string[],
  flags: Readonly<Record<string, string | boolean>>,
): Promise<number> {
  if (command[0] === "list" && command.length === 1) {
    const result = await client.workflows.list();
    printResult(result.workflows, config.json);
    return 0;
  }
  if (command[0] === "get" && typeof command[1] === "string") {
    const result = await client.workflows.get(command[1] as never);
    printResult(result, config.json);
    return 0;
  }
  if (command[0] === "run" && command.length === 1) {
    const workflowVersionId = requireFlag(flags, "workflow-version-id");
    const input = parseJsonFlag(flags, "input", {});
    const result = await client.workflowRuns.create({
      workflowVersionId: workflowVersionId as never,
      input: input as JsonValue,
    });
    printResult(result, config.json);
    return 0;
  }
  printError(
    "Usage: osva workflows list | osva workflows get <workflowId> | osva workflows run --workflow-version-id ... [--input '{}']",
  );
  return 1;
}

async function runWorkflowRuns(
  client: OsvaClient,
  config: CliConfig,
  command: readonly string[],
): Promise<number> {
  if (command[0] === "get" && typeof command[1] === "string") {
    const result = await client.workflowRuns.get(command[1] as never);
    printResult(result, config.json);
    return 0;
  }
  printError("Usage: osva workflow-runs get <workflowRunId>");
  return 1;
}

async function runApprovals(
  client: OsvaClient,
  config: CliConfig,
  command: readonly string[],
  flags: Readonly<Record<string, string | boolean>>,
): Promise<number> {
  if (command[0] === "get" && typeof command[1] === "string") {
    const result = await client.approvals.get(command[1] as never);
    printResult(result, config.json);
    return 0;
  }
  if (
    (command[0] === "approve" || command[0] === "reject") &&
    typeof command[1] === "string"
  ) {
    const comment =
      typeof flags.comment === "string" ? flags.comment : undefined;
    const result = await client.approvals.decide(command[1] as never, {
      decision: command[0] === "approve" ? "APPROVED" : "REJECTED",
      ...(comment === undefined ? {} : { comment }),
    });
    printResult(result, config.json);
    return 0;
  }
  printError(
    "Usage: osva approvals get <id> | osva approvals approve <id> [--comment ...] | osva approvals reject <id> [--comment ...]",
  );
  return 1;
}

async function runSchedules(
  client: OsvaClient,
  config: CliConfig,
  command: readonly string[],
): Promise<number> {
  if (command[0] === "list" && command.length === 1) {
    const result = await client.schedules.list();
    printResult(result.schedules, config.json);
    return 0;
  }
  printError("Usage: osva schedules list");
  return 1;
}

function requireFlag(
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required flag --${name}.`);
  }
  return value;
}

function parseJsonFlag(
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
  fallback: unknown,
): unknown {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  return JSON.parse(value) as unknown;
}

function printHelp(): void {
  process.stdout.write(`OSVA CLI

Usage:
  osva [--base-url URL] [--workspace-id ID] [--json] <command>

Commands:
  agents list
  agents get <agentId>
  runs create --agent-id ID --agent-version-id ID [--input JSON]
  runs get <runId>
  workflows list
  workflows get <workflowId>
  workflows run --workflow-version-id ID [--input JSON]
  workflow-runs get <workflowRunId>
  approvals get <approvalRequestId>
  approvals approve <approvalRequestId> [--comment TEXT]
  approvals reject <approvalRequestId> [--comment TEXT]
  schedules list
  version
  help

Environment:
  OSVA_BASE_URL
  OSVA_WORKSPACE_ID
`);
}
