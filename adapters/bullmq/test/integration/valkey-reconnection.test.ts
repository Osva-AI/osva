import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BullMqJobQueue } from "../../src/bullmq-job-queue.js";
import { checkValkeyConnection } from "../../src/check-valkey-connection.js";
import type { RunAttemptId } from "@osva-ai/contracts";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "./valkey-harness.js";

const RUN_ATTEMPT = "reconnect-run-attempt" as RunAttemptId;
const SECOND_RUN_ATTEMPT = "reconnect-run-attempt-2" as RunAttemptId;

async function stopDockerValkey(context: ValkeyTestContext): Promise<void> {
  if (!context.usingDocker || !context.dockerBin || !context.containerName) {
    throw new Error(
      "Docker Valkey is required for reconnection integration test.",
    );
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  await execFileAsync(context.dockerBin, [
    "stop",
    "-t",
    "2",
    context.containerName,
  ]);
}

async function resolveDockerValkeyUrl(
  context: ValkeyTestContext,
): Promise<string> {
  if (!context.dockerBin || !context.containerName) {
    return context.url;
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(context.dockerBin, [
    "port",
    context.containerName,
    "6379/tcp",
  ]);
  const match = stdout.match(/:(\d+)\s*$/m);
  if (!match?.[1]) {
    throw new Error("Could not resolve Valkey published port.");
  }
  return `redis://127.0.0.1:${match[1]}`;
}

async function startDockerValkey(context: ValkeyTestContext): Promise<string> {
  if (!context.usingDocker || !context.dockerBin || !context.containerName) {
    throw new Error(
      "Docker Valkey is required for reconnection integration test.",
    );
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  await execFileAsync(context.dockerBin, [
    "restart",
    "-t",
    "2",
    context.containerName,
  ]);
  const url = await resolveDockerValkeyUrl(context);
  await waitForHostValkey(url, 60_000);
  return url;
}

async function waitForHostValkey(
  url: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await checkValkeyConnection(url);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error("Host Valkey did not become ready");
}

describe("Valkey reconnection (integration)", () => {
  let valkey: ValkeyTestContext | undefined;

  beforeAll(async () => {
    valkey = await startValkeyForTests();
  }, 120_000);

  afterAll(async () => {
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  it("recovers host readiness checks and queue operations after container restart", async () => {
    if (!valkey?.usingDocker) {
      return;
    }

    let url = valkey.url;
    await checkValkeyConnection(url);
    let queue = new BullMqJobQueue({
      url,
      prefix: `reconnect-${String(process.pid)}`,
    });
    try {
      await queue.ping();
      expect(await queue.enqueue(RUN_ATTEMPT)).toEqual({ outcome: "enqueued" });

      await stopDockerValkey(valkey);
      await expect(checkValkeyConnection(url)).rejects.toThrow();
      await expect(queue.ping()).rejects.toThrow();

      url = await startDockerValkey(valkey);
      await expect(checkValkeyConnection(url)).resolves.toBeUndefined();

      await queue.shutdown();
      queue = new BullMqJobQueue({
        url,
        prefix: `reconnect-${String(process.pid)}-after`,
      });
      await expect(queue.ping()).resolves.toBeUndefined();
      expect(await queue.enqueue(SECOND_RUN_ATTEMPT)).toEqual({
        outcome: "enqueued",
      });
    } finally {
      await queue.shutdown();
    }
  }, 180_000);
});
