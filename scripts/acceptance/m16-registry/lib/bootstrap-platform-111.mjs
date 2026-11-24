import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { deriveComposeProjectName } from "../../m16-shared/compose-project.mjs";

const FIXTURE_COMPOSE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/compose-platform-1.1.1.yml",
);

/**
 * Bootstrap a platform 1.1.1 installation layout (M16 compose-install template)
 * for cross-version upgrade acceptance. Uses the published 1.1.1 GHCR image only.
 *
 * @param {object} input
 * @param {string} input.installDir
 * @param {string} input.imageRef
 * @param {number} input.webPort
 * @param {number} input.mcpPort
 * @param {number} [input.consolePort]
 */
export async function bootstrapPlatform111Install(input) {
  const composeProjectName = deriveComposeProjectName(input.installDir);
  const consolePort = input.consolePort ?? 4174;
  const composeYaml = await readFile(FIXTURE_COMPOSE, "utf8");

  await mkdir(path.join(input.installDir, ".osva"), { recursive: true });
  const postgresPassword = randomBytes(24).toString("hex");
  const authSecret = randomBytes(32).toString("hex");
  const envLines = [
    `OSVA_IMAGE=${input.imageRef}`,
    `COMPOSE_PROJECT_NAME=${composeProjectName}`,
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `OSVA_VALKEY_URL=redis://valkey:6379`,
    `OSVA_AUTH_SECRET=${authSecret}`,
    `OSVA_PUBLISH_WEB_PORT=${String(input.webPort)}`,
    `OSVA_PUBLISH_MCP_PORT=${String(input.mcpPort)}`,
    `OSVA_PUBLISH_CONSOLE_PORT=${String(consolePort)}`,
    `OSVA_AUTH_BASE_URL=http://127.0.0.1:${String(consolePort)}`,
    `OSVA_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:${String(consolePort)}`,
  ];
  const now = new Date().toISOString();
  const marker = {
    schemaVersion: 1,
    platformVersion: "1.1.1",
    imageRef: input.imageRef,
    cliVersion: "acceptance-bootstrap",
    installDir: input.installDir,
    composeProjectName,
    createdAt: now,
    updatedAt: now,
  };

  await writeFile(
    path.join(input.installDir, "compose.yml"),
    composeYaml,
    "utf8",
  );
  await writeFile(
    path.join(input.installDir, ".env"),
    `${envLines.join("\n")}\n`,
    {
      mode: 0o600,
    },
  );
  await writeFile(
    path.join(input.installDir, ".osva", "installation.json"),
    `${JSON.stringify(marker, null, 2)}\n`,
    { mode: 0o600 },
  );

  return { marker, postgresPassword, authSecret };
}
