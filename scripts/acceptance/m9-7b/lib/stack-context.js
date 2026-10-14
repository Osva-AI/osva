import { runDbCli } from "./infra.js";
import { withTimeout } from "./timeouts.js";
import {
  bootstrapApiKey,
  createStackPaths,
  ensureBuildArtifacts,
  getRepoRoot,
  resolveValkeyUrl,
  startWebWorkerProcesses,
  stopProcessGracefully,
  waitForHttpOk,
} from "./stack.js";

export async function resetStackWithPaths(ctx, paths) {
  if (ctx.origin) {
    await shutdownStack(ctx);
    ctx.origin = undefined;
    ctx.processes = undefined;
    ctx.stackStopped = false;
  }
  ctx.paths = paths;
  await ensureStack(ctx);
}

export async function ensureStack(ctx) {
  if (ctx.origin) {
    return;
  }
  await ensureDatabaseReady(ctx);
  await ensureBuildArtifacts();
  if (!ctx.paths) {
    ctx.paths = await createStackPaths(ctx.runId);
  }
  const webPort = await allocatePort();
  ctx.webPort = webPort;
  ctx.processes = startWebWorkerProcesses(
    ctx.infra,
    ctx.paths,
    String(webPort),
    ctx.processEnvExtras ?? {},
  );
  ctx.origin = `http://127.0.0.1:${String(webPort)}`;
  await waitForHttpOk(`${ctx.origin}/health`);
  await waitForHttpOk(`${ctx.origin}/ready`);
  if (!ctx.auth) {
    ctx.auth = await bootstrapApiKey(ctx.infra.postgres.connectionString);
  }
}

export async function shutdownStack(ctx) {
  if (ctx.processes?.workerExtra) {
    await stopProcessGracefully(ctx.processes.workerExtra, "worker-extra");
    ctx.processes.workerExtra = undefined;
  }
  if (ctx.processes) {
    await stopProcessGracefully(ctx.processes.web, "web");
    await stopProcessGracefully(ctx.processes.worker, "worker");
    ctx.stackStopped = true;
    ctx.processes = undefined;
  }
}

export async function restartAppProcesses(ctx) {
  await stopProcessGracefully(ctx.processes.web, "web");
  await stopProcessGracefully(ctx.processes.worker, "worker");
  if (ctx.processes.workerExtra) {
    await stopProcessGracefully(ctx.processes.workerExtra, "worker-extra");
    ctx.processes.workerExtra = undefined;
  }
  ctx.processes = startWebWorkerProcesses(
    ctx.infra,
    ctx.paths,
    String(ctx.webPort),
    ctx.processEnvExtras ?? {},
  );
  await waitForHttpOk(`${ctx.origin}/health`);
  await waitForHttpOk(`${ctx.origin}/ready`);
}

export function appValkeyUrl(ctx) {
  return resolveValkeyUrl(ctx.infra);
}

export async function ensureDatabaseReady(ctx) {
  if (ctx.dbMigrated) {
    return;
  }
  const repoRoot = getRepoRoot();
  await withTimeout(
    runDbCli(repoRoot, "migrate-cli.js", ctx.infra.postgres.connectionString),
    120_000,
    "db migrate",
  );
  ctx.dbMigrated = true;
}

async function allocatePort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate port"));
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
