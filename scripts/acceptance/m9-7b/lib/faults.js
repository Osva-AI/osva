import { execInContainer } from "./docker.js";
import {
  stopContainer,
  startContainer,
  restartContainer,
  pauseContainer,
  unpauseContainer,
} from "./docker.js";
import { waitUntil } from "./timeouts.js";
export async function stopAcceptanceValkey(ctx) {
  const { dockerBin, infra } = ctx;
  await stopContainer(dockerBin, infra.valkey.containerName, infra.runId);
}

export async function startAcceptanceValkey(ctx) {
  const { dockerBin, infra } = ctx;
  await startContainer(dockerBin, infra.valkey.containerName, infra.runId);
}

export async function restartValkeyDependency(ctx, options = {}) {
  const { dockerBin, infra } = ctx;
  if (options.skipStop === true) {
    await restartContainer(dockerBin, infra.valkey.containerName, infra.runId);
  } else {
    await stopAcceptanceValkey(ctx);
    await startAcceptanceValkey(ctx);
  }
  await waitUntil(
    async () => {
      try {
        const ping = await execInContainer(
          dockerBin,
          infra.valkey.containerName,
          infra.runId,
          ["valkey-cli", "ping"],
        );
        return ping.includes("PONG");
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 15_000,
      message: "Valkey container CLI ping did not recover",
    },
  );
}

export async function stopAcceptancePostgres(ctx) {
  const { dockerBin, infra } = ctx;
  await stopContainer(dockerBin, infra.postgres.containerName, infra.runId);
}

export async function startAcceptancePostgres(ctx) {
  const { dockerBin, infra } = ctx;
  await startContainer(dockerBin, infra.postgres.containerName, infra.runId);
  await waitUntil(
    async () => {
      try {
        await execInContainer(
          dockerBin,
          infra.postgres.containerName,
          infra.runId,
          ["pg_isready", "-U", "osva", "-d", "osva_acceptance"],
        );
        return true;
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 60_000,
      message: "PostgreSQL did not become ready after start",
    },
  );
}

export async function pauseUnpausePostgres(ctx) {
  const { dockerBin, infra } = ctx;
  try {
    await pauseContainer(dockerBin, infra.postgres.containerName, infra.runId);
    await unpauseContainer(
      dockerBin,
      infra.postgres.containerName,
      infra.runId,
    );
    return { mode: "pause-unpause", supported: true };
  } catch (error) {
    return {
      mode: "pause-unpause",
      supported: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
