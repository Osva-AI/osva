import { createDatabase } from "./database.js";
import { migrateDatabase } from "./migrate.js";
import { randomUUID } from "node:crypto";
import { createApiKeyApplication } from "@osva/domain";
import type { WorkspaceId } from "@osva-ai/contracts";

import { PostgresApiKeyRepository } from "./repositories/postgres-api-key-repository.js";
import { PostgresWorkspaceRepository } from "./repositories/postgres-workspace-repository.js";

interface BootstrapCliOptions {
  readonly connectionString?: string;
  readonly workspaceName: string;
  readonly workspaceId?: WorkspaceId;
  readonly skipAdminApiKey: boolean;
}

function parseBootstrapCliOptions(
  argv: readonly string[],
): BootstrapCliOptions {
  let connectionString = process.env.OSVA_DATABASE_URL?.trim();
  let workspaceName =
    process.env.OSVA_BOOTSTRAP_WORKSPACE_NAME?.trim() ?? "Default Workspace";
  let workspaceId: WorkspaceId | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--workspace-id=")) {
      workspaceId = arg.slice("--workspace-id=".length) as WorkspaceId;
      continue;
    }

    if (arg.startsWith("--workspace-name=")) {
      workspaceName = arg.slice("--workspace-name=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      continue;
    }

    if (connectionString === undefined || connectionString.length === 0) {
      connectionString = arg;
    }
  }

  const skipEnv = process.env.OSVA_BOOTSTRAP_SKIP_ADMIN_API_KEY?.trim();
  const skipAdminApiKey = skipEnv === "1" || skipEnv?.toLowerCase() === "true";

  return {
    connectionString,
    workspaceName,
    workspaceId,
    skipAdminApiKey,
  };
}

const options = parseBootstrapCliOptions(process.argv.slice(2));

if (!options.connectionString) {
  console.error(
    [
      "Usage: node dist/bootstrap-cli.js <connectionString> [--workspace-name NAME] [--workspace-id ID]",
      "Or set OSVA_DATABASE_URL.",
      "",
      "Creates the initial ADMIN API key. When no workspaces exist, also creates the first workspace.",
      "When workspaces already exist but no API keys exist, --workspace-id is required.",
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  const database = createDatabase({
    connectionString: options.connectionString,
    max: 1,
  });
  const apiKeys = new PostgresApiKeyRepository(database);
  const workspaces = new PostgresWorkspaceRepository(database);
  const clock = { now: () => new Date() };
  const ids = { createId: () => randomUUID() };
  const application = createApiKeyApplication({
    apiKeys,
    workspaces,
    clock,
    ids,
  });

  migrateDatabase(database)
    .then(async () =>
      application.bootstrapInstallation.execute({
        workspaceName: options.workspaceName,
        ...(options.workspaceId === undefined
          ? {}
          : { workspaceId: options.workspaceId }),
        ...(options.skipAdminApiKey ? { createMachineAdminApiKey: false } : {}),
      }),
    )
    .then(async (result) => {
      const lines = [
        "OSVA installation bootstrap completed.",
        `Workspace ID: ${result.workspace.id}`,
      ];
      if (result.apiKey !== undefined && result.plaintextToken !== undefined) {
        lines.push(
          `API key ID: ${result.apiKey.id}`,
          `Role: ${result.apiKey.role}`,
          "",
          "Copy the API key below now. It cannot be retrieved again:",
          result.plaintextToken,
          "",
        );
      } else {
        lines.push(
          "",
          "No machine ADMIN API key was created (human-first bootstrap).",
          "Create a scoped key from Console Settings → API Keys after sign-in.",
          "",
        );
      }
      process.stdout.write(lines.join("\n"));
      await database.close();
    })
    .catch(async (error: unknown) => {
      await database.close();
      console.error(error);
      process.exitCode = 1;
    });
}
