import { runDocker, runDockerCapture } from "./docker-cli.mjs";

export const SMOKE_NETWORK = "osva-deploy-smoke";
export const SMOKE_POSTGRES = "osva-deploy-smoke-postgres";
export const SMOKE_VALKEY = "osva-deploy-smoke-valkey";

const POSTGRES_IMAGE = "pgvector/pgvector:pg17";
const VALKEY_IMAGE = "valkey/valkey:8.1.10-alpine";

export function removeSmokeInfra() {
  for (const name of [SMOKE_POSTGRES, SMOKE_VALKEY]) {
    try {
      runDocker(["rm", "-f", name], { stdio: "pipe" });
    } catch {
      // already removed
    }
  }
  try {
    runDocker(["network", "rm", SMOKE_NETWORK], { stdio: "pipe" });
  } catch {
    // already removed
  }
}

export async function startSmokeInfra() {
  removeSmokeInfra();
  runDocker(["network", "create", SMOKE_NETWORK]);
  runDocker([
    "run",
    "-d",
    "--name",
    SMOKE_POSTGRES,
    "--network",
    SMOKE_NETWORK,
    "-e",
    "POSTGRES_DB=osva",
    "-e",
    "POSTGRES_USER=osva",
    "-e",
    "POSTGRES_PASSWORD=osva",
    POSTGRES_IMAGE,
  ]);
  runDocker([
    "run",
    "-d",
    "--name",
    SMOKE_VALKEY,
    "--network",
    SMOKE_NETWORK,
    VALKEY_IMAGE,
    "valkey-server",
  ]);

  await waitForPostgres();
  await waitForValkey();
}

async function waitForPostgres(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      runDocker(
        ["exec", SMOKE_POSTGRES, "pg_isready", "-U", "osva", "-d", "osva"],
        { stdio: "pipe" },
      );
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("PostgreSQL smoke dependency did not become ready.");
}

async function waitForValkey(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const output = runDockerCapture(
        ["exec", SMOKE_VALKEY, "valkey-cli", "ping"],
        {},
      );
      if (output.trim() === "PONG") {
        return;
      }
    } catch {
      // retry
    }
    await sleep(1000);
  }
  throw new Error("Valkey smoke dependency did not become ready.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function smokeDatabaseUrl() {
  return `postgres://osva:osva@${SMOKE_POSTGRES}:5432/osva`;
}

export function smokeValkeyUrl() {
  return `redis://${SMOKE_VALKEY}:6379`;
}

export function baseOsvaContainerEnv(imageEnv = {}) {
  return {
    OSVA_DATABASE_URL: smokeDatabaseUrl(),
    OSVA_VALKEY_URL: smokeValkeyUrl(),
    OSVA_WEB_HOST: "0.0.0.0",
    OSVA_WEB_PORT: "3000",
    OSVA_ARTIFACT_STORAGE_DRIVER: "filesystem",
    OSVA_ARTIFACT_FILESYSTEM_ROOT: "/var/lib/osva/artifacts",
    OSVA_TRUSTED_RUNTIME_ROOT: "/var/lib/osva/trusted-runtime",
    OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
    OSVA_KNOWLEDGE_EMBEDDING_MODEL: "deterministic-v1",
    OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS: "384",
    OSVA_CONTAINER_ENABLED: "false",
    ...imageEnv,
  };
}

export function dockerEnvFlags(env) {
  return Object.entries(env).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);
}
