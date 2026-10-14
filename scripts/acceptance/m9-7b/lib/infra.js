import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  POSTGRES_IMAGE,
  VALKEY_IMAGE,
  INFRA_READY_TIMEOUT_MS,
} from "./constants.js";
import {
  createAcceptanceNetwork,
  dockerRunInfra,
  execInContainer,
  removeAcceptanceNetwork,
  removeContainer,
  resolvePublishedHostPort,
} from "./docker.js";
import { waitUntil } from "./timeouts.js";
import { redactDatabaseUrl, redactRedisUrl } from "./redact.js";

const execFileAsync = promisify(execFile);

async function allocateHostPort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate host port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

export async function startAcceptanceInfra(dockerBin, runId, options = {}) {
  const shortId = runId.replaceAll("-", "").slice(0, 12);
  const postgresName = `osva-m97b-${shortId}-pg`;
  const valkeyName = `osva-m97b-${shortId}-valkey`;

  const needsNetwork =
    options.stableValkeyEndpoint === true ||
    options.stablePostgresEndpoint === true;
  let networkName;
  if (needsNetwork) {
    networkName = `osva-m97b-${shortId}-net`;
    await createAcceptanceNetwork(dockerBin, networkName, runId);
  }

  let postgresProxyName;
  let stablePostgresPort;
  let postgresPort;
  if (options.stablePostgresEndpoint) {
    await dockerRunInfra(dockerBin, {
      runId,
      role: "postgres",
      name: postgresName,
      publishHostPort: false,
      containerPort: 5432,
      networkName,
      image: POSTGRES_IMAGE,
      preArgs: [
        "--env",
        "POSTGRES_USER=osva",
        "--env",
        "POSTGRES_PASSWORD=osva_acceptance",
        "--env",
        "POSTGRES_DB=osva_acceptance",
      ],
    });
    stablePostgresPort = await allocateHostPort();
    postgresProxyName = `osva-m97b-${shortId}-pg-proxy`;
    await dockerRunInfra(dockerBin, {
      runId,
      role: "postgres-proxy",
      name: postgresProxyName,
      publishHostPort: true,
      publishFixedHostPort: stablePostgresPort,
      containerPort: 5432,
      networkName,
      image: "alpine/socat",
      commandArgs: [
        "TCP-LISTEN:5432,fork,reuseaddr",
        `TCP:${postgresName}:5432`,
      ],
    });
    postgresPort = stablePostgresPort;
  } else {
    postgresPort = await dockerRunInfra(dockerBin, {
      runId,
      role: "postgres",
      name: postgresName,
      publishHostPort: true,
      containerPort: 5432,
      image: POSTGRES_IMAGE,
      preArgs: [
        "--env",
        "POSTGRES_USER=osva",
        "--env",
        "POSTGRES_PASSWORD=osva_acceptance",
        "--env",
        "POSTGRES_DB=osva_acceptance",
      ],
    });
  }

  let valkeyPort;
  let valkeyProxyName;
  let stableValkeyPort;
  if (options.stableValkeyEndpoint) {
    await dockerRunInfra(dockerBin, {
      runId,
      role: "valkey",
      name: valkeyName,
      publishHostPort: false,
      containerPort: 6379,
      networkName,
      image: VALKEY_IMAGE,
      commandArgs: ["valkey-server", "--appendonly", "yes"],
    });
    stableValkeyPort = await allocateHostPort();
    valkeyProxyName = `osva-m97b-${shortId}-valkey-proxy`;
    await dockerRunInfra(dockerBin, {
      runId,
      role: "valkey-proxy",
      name: valkeyProxyName,
      publishHostPort: true,
      publishFixedHostPort: stableValkeyPort,
      containerPort: 6379,
      networkName,
      image: "alpine/socat",
      commandArgs: ["TCP-LISTEN:6379,fork,reuseaddr", `TCP:${valkeyName}:6379`],
    });
    valkeyPort = stableValkeyPort;
  } else {
    valkeyPort = await dockerRunInfra(dockerBin, {
      runId,
      role: "valkey",
      name: valkeyName,
      publishHostPort: true,
      containerPort: 6379,
      image: VALKEY_IMAGE,
      commandArgs: ["valkey-server", "--appendonly", "yes"],
    });
  }

  const databaseUrl = `postgres://osva:osva_acceptance@127.0.0.1:${postgresPort}/osva_acceptance`;
  const directValkeyUrl = options.stableValkeyEndpoint
    ? undefined
    : `redis://127.0.0.1:${valkeyPort}`;
  const valkeyUrl = options.stableValkeyEndpoint
    ? `redis://127.0.0.1:${stableValkeyPort}`
    : directValkeyUrl;

  await waitUntil(
    async () => {
      try {
        await execInContainer(dockerBin, postgresName, runId, [
          "pg_isready",
          "-U",
          "osva",
          "-d",
          "osva_acceptance",
        ]);
        return true;
      } catch {
        return false;
      }
    },
    {
      timeoutMs: INFRA_READY_TIMEOUT_MS,
      message: "PostgreSQL did not become ready",
    },
  );

  await waitUntil(
    async () => {
      try {
        const ping = await execInContainer(dockerBin, valkeyName, runId, [
          "valkey-cli",
          "ping",
        ]);
        return ping.includes("PONG");
      } catch {
        return false;
      }
    },
    {
      timeoutMs: INFRA_READY_TIMEOUT_MS,
      message: "Valkey did not become ready",
    },
  );

  return {
    runId,
    postgres: {
      containerName: postgresName,
      proxyContainerName: postgresProxyName,
      stableEndpoint: Boolean(options.stablePostgresEndpoint),
      hostPort: postgresPort,
      connectionString: databaseUrl,
      connectionStringRedacted: redactDatabaseUrl(databaseUrl),
    },
    valkey: {
      containerName: valkeyName,
      proxyContainerName: valkeyProxyName,
      networkName,
      stableEndpoint: Boolean(options.stableValkeyEndpoint),
      hostPort: valkeyPort,
      url: valkeyUrl,
      urlRedacted: redactRedisUrl(valkeyUrl),
      stableUrl: options.stableValkeyEndpoint ? valkeyUrl : undefined,
      stableUrlRedacted: options.stableValkeyEndpoint
        ? redactRedisUrl(valkeyUrl)
        : undefined,
    },
  };
}

export async function refreshPostgresEndpoint(dockerBin, infra) {
  if (infra.postgres.stableEndpoint) {
    return {
      previousPort: infra.postgres.hostPort,
      hostPort: infra.postgres.hostPort,
      portChanged: false,
      stableProxy: true,
    };
  }
  const hostPort = await resolvePublishedHostPort(
    dockerBin,
    infra.postgres.containerName,
    5432,
  );
  const previousPort = infra.postgres.hostPort;
  infra.postgres.hostPort = hostPort;
  infra.postgres.connectionString = `postgres://osva:osva_acceptance@127.0.0.1:${hostPort}/osva_acceptance`;
  infra.postgres.connectionStringRedacted = redactDatabaseUrl(
    infra.postgres.connectionString,
  );
  return {
    previousPort,
    hostPort,
    portChanged: String(previousPort) !== String(hostPort),
  };
}

export async function refreshValkeyEndpoint(dockerBin, infra) {
  const hostPort = await resolvePublishedHostPort(
    dockerBin,
    infra.valkey.containerName,
    6379,
  );
  const previousPort = infra.valkey.hostPort;
  infra.valkey.hostPort = hostPort;
  infra.valkey.url = `redis://127.0.0.1:${hostPort}`;
  infra.valkey.urlRedacted = redactRedisUrl(infra.valkey.url);
  return {
    previousPort,
    hostPort,
    portChanged: String(previousPort) !== String(hostPort),
  };
}

export async function stopAcceptanceInfra(dockerBin, infra) {
  if (infra.postgres.proxyContainerName) {
    await removeContainer(
      dockerBin,
      infra.postgres.proxyContainerName,
      infra.runId,
    );
  }
  if (infra.valkey.proxyContainerName) {
    await removeContainer(
      dockerBin,
      infra.valkey.proxyContainerName,
      infra.runId,
    );
  }
  await removeContainer(dockerBin, infra.valkey.containerName, infra.runId);
  await removeContainer(dockerBin, infra.postgres.containerName, infra.runId);
  if (infra.valkey.networkName) {
    await removeAcceptanceNetwork(
      dockerBin,
      infra.valkey.networkName,
      infra.runId,
    );
  }
}

export async function queryPostgresStatus(dockerBin, infra, runAttemptId) {
  const sql = `SELECT status FROM run_attempts WHERE id = '${runAttemptId.replaceAll("'", "''")}' LIMIT 1;`;
  const stdout = await execInContainer(
    dockerBin,
    infra.postgres.containerName,
    infra.runId,
    ["psql", "-U", "osva", "-d", "osva_acceptance", "-t", "-A", "-c", sql],
  );
  return stdout.trim();
}

export async function runDbCli(repoRoot, scriptRelative, connectionString) {
  const scriptPath = `${repoRoot}/packages/db/dist/${scriptRelative}`;
  await execFileAsync(process.execPath, [scriptPath, connectionString], {
    env: {
      ...process.env,
      OSVA_DATABASE_URL: connectionString,
    },
    stdio: "pipe",
  });
}
