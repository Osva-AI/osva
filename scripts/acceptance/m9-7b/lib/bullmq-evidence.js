import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { getRepoRoot } from "./stack.js";
import { toBullMqJobIdFromDist } from "./bullmq-job-id.js";

export async function loadBullMqJobQueue() {
  const modulePath = path.join(
    getRepoRoot(),
    "adapters/bullmq/dist/bullmq-job-queue.js",
  );
  const module = await import(pathToFileURL(modulePath).href);
  return module.BullMqJobQueue;
}

export async function inspectTransportState(valkeyUrl, runAttemptId) {
  const BullMqJobQueue = await loadBullMqJobQueue();
  const queue = new BullMqJobQueue({ url: valkeyUrl });
  try {
    const jobId = await toBullMqJobIdFromDist(runAttemptId);
    const job = await queue.getQueuedJob(runAttemptId);
    const activeCount = await queue.countActiveJobs();
    const claimExists = await redisClaimExists(valkeyUrl, jobId);
    return {
      jobId,
      job,
      activeCount,
      claimKeyExists: claimExists.exists,
      claimTtlMs: claimExists.ttlMs,
    };
  } finally {
    await queue.shutdown();
  }
}

function loadRedisClient() {
  const require = createRequire(
    path.join(getRepoRoot(), "adapters/bullmq/package.json"),
  );
  return require("ioredis");
}

async function redisClaimExists(valkeyUrl, jobId) {
  const Redis = loadRedisClient();
  const connection = new Redis(valkeyUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    lazyConnect: true,
  });
  try {
    await connection.connect();
    const claimKey = `bull:osva-execution:osva-enqueue-claim:${jobId}`;
    const exists = (await connection.exists(claimKey)) === 1;
    const ttlMs = exists ? await connection.pttl(claimKey) : null;
    return { exists, ttlMs };
  } finally {
    try {
      await connection.quit();
    } catch {
      connection.disconnect();
    }
  }
}

export async function cancelTransportJob(valkeyUrl, runAttemptId) {
  const BullMqJobQueue = await loadBullMqJobQueue();
  const queue = new BullMqJobQueue({ url: valkeyUrl });
  try {
    await queue.cancel(runAttemptId);
  } finally {
    await queue.shutdown();
  }
}

export async function removeBullMqJobHash(valkeyUrl, runAttemptId) {
  const jobId = await toBullMqJobIdFromDist(runAttemptId);
  const Redis = loadRedisClient();
  const connection = new Redis(valkeyUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    lazyConnect: true,
  });
  try {
    await connection.connect();
    const jobKey = `bull:osva-execution:${jobId}`;
    await connection.del(jobKey);
    return { jobKey, jobId };
  } finally {
    try {
      await connection.quit();
    } catch {
      connection.disconnect();
    }
  }
}
