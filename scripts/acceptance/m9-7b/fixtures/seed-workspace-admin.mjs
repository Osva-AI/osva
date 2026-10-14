import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const connectionString = process.argv[2];
const workspaceName = process.argv[3] ?? "Acceptance Workspace B";

if (!connectionString) {
  console.error(
    "Usage: seed-workspace-admin.mjs <connectionString> [workspaceName]",
  );
  process.exit(1);
}

const { createDatabase } = await import(
  pathToFileURL(path.join(repoRoot, "packages/db/dist/database.js")).href
);
const { PostgresApiKeyRepository, PostgresWorkspaceRepository } = await import(
  pathToFileURL(path.join(repoRoot, "packages/db/dist/index.js")).href
);
const { Workspace, createApiKeyApplication } = await import(
  pathToFileURL(path.join(repoRoot, "packages/domain/dist/index.js")).href
);

const workspaceId = randomUUID();
const now = new Date();
const database = createDatabase({
  connectionString,
  max: 2,
  connectTimeoutSeconds: 10,
});

try {
  const workspaces = new PostgresWorkspaceRepository(database);
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: workspaceName,
      createdAt: now,
    }),
  );
  const apiKeys = new PostgresApiKeyRepository(database);
  const application = createApiKeyApplication({
    apiKeys,
    workspaces,
    clock: { now: () => now },
    ids: { createId: () => randomUUID() },
  });
  const created = await application.createApiKey.execute({
    workspaceId,
    name: "acceptance-admin",
    role: "ADMIN",
  });
  console.log(
    JSON.stringify({
      workspaceId,
      token: created.plaintextToken,
      apiKeyId: created.apiKey.id,
    }),
  );
} finally {
  await database.close();
}
