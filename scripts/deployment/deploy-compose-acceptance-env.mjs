import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const DRIZZLE_JOURNAL_PATH = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "drizzle",
  "meta",
  "_journal.json",
);

/** Repository migration head from the committed Drizzle journal (canonical for deploy acceptance). */
export function readRepositoryMigrationHead() {
  const journal = JSON.parse(fs.readFileSync(DRIZZLE_JOURNAL_PATH, "utf8"));
  const tag = journal.entries?.at(-1)?.tag;
  if (typeof tag !== "string" || tag.length === 0) {
    throw new Error(`Missing migration head in ${DRIZZLE_JOURNAL_PATH}`);
  }
  return tag;
}

export const EXPECTED_MIGRATION_HEAD = readRepositoryMigrationHead();

const DEFAULT_POSTGRES_PASSWORD = "compose-acceptance-password";
const DEFAULT_WEB_PORT = "18080";
const DEFAULT_MCP_PORT = "13100";
const DEFAULT_AUTH_SECRET = "compose-acceptance-test-osva-auth-secret-32";

/** Keys required whenever Docker Compose parses deploy/compose/compose.yml */
export const COMPOSE_PARSE_ENV_KEYS = [
  "POSTGRES_PASSWORD",
  "OSVA_PUBLISH_WEB_PORT",
  "OSVA_PUBLISH_MCP_PORT",
  "OSVA_AUTH_SECRET",
  "OSVA_AUTH_BASE_URL",
  "OSVA_AUTH_TRUSTED_ORIGINS",
];

/**
 * Environment passed to every `docker compose` invocation in deploy acceptance.
 * Test-only defaults; production compose still requires OSVA_AUTH_SECRET via compose.yml.
 */
export function buildComposeAcceptanceEnv(env = process.env) {
  const password = env.POSTGRES_PASSWORD ?? DEFAULT_POSTGRES_PASSWORD;
  const webPort = env.OSVA_PUBLISH_WEB_PORT ?? DEFAULT_WEB_PORT;
  const mcpPort = env.OSVA_PUBLISH_MCP_PORT ?? DEFAULT_MCP_PORT;
  const webOrigin = `http://127.0.0.1:${webPort}`;
  return {
    POSTGRES_PASSWORD: password,
    OSVA_PUBLISH_WEB_PORT: webPort,
    OSVA_PUBLISH_MCP_PORT: String(mcpPort),
    OSVA_AUTH_SECRET: env.OSVA_AUTH_SECRET ?? DEFAULT_AUTH_SECRET,
    OSVA_AUTH_BASE_URL: env.OSVA_AUTH_BASE_URL ?? webOrigin,
    OSVA_AUTH_TRUSTED_ORIGINS: env.OSVA_AUTH_TRUSTED_ORIGINS ?? webOrigin,
  };
}
