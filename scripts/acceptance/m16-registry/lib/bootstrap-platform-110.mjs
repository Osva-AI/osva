import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { deriveComposeProjectName } from "../../m16-shared/compose-project.mjs";

const FIXTURE_COMPOSE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/compose-platform-1.1.0.yml",
);

/**
 * Strip local `build:` stanzas from legacy deploy/compose for published-image installs.
 *
 * @param {string} composeRaw
 * @returns {string}
 */
export function transformLegacyComposeForPublishedImage(composeRaw) {
  return composeRaw
    .replace(/\n\s*build:\s*\n\s*context:[^\n]*\n\s*dockerfile:[^\n]*\n/g, "\n")
    .replace(
      /image: \$\{OSVA_IMAGE:-osva:local\}/,
      "image: ${OSVA_IMAGE:?OSVA_IMAGE is required}",
    );
}

/**
 * Bootstrap a platform 1.1.0 installation layout (legacy deploy/compose, no Console)
 * for cross-version upgrade acceptance. Uses the published 1.1.0 GHCR image only.
 *
 * @param {object} input
 * @param {string} input.installDir
 * @param {string} input.imageRef
 * @param {number} input.webPort
 * @param {number} input.mcpPort
 */
export async function bootstrapPlatform110Install(input) {
  const composeProjectName = deriveComposeProjectName(input.installDir);
  const composeRaw = await readFile(FIXTURE_COMPOSE, "utf8");
  const composeYaml = transformLegacyComposeForPublishedImage(composeRaw);

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
    `OSVA_PUBLISH_CONSOLE_PORT=4174`,
    `OSVA_AUTH_BASE_URL=http://127.0.0.1:${String(input.webPort)}`,
    `OSVA_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:${String(input.webPort)}`,
  ];
  const now = new Date().toISOString();
  const marker = {
    schemaVersion: 1,
    platformVersion: "1.1.0",
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
