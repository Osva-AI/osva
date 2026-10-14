import { randomUUID } from "node:crypto";

import type { JobEnqueueResult } from "@osva-ai/contracts";
import type { Queue } from "bullmq";

import type { EnqueueClaimTestHooksInput } from "./enqueue-test-hooks.js";

const ENQUEUE_CLAIM_TTL_SECONDS = 60;
/** Remaining TTL above this threshold means another caller holds a fresh claim. */
const ENQUEUE_CLAIM_IN_FLIGHT_PTTL_MS = 45_000;

type EnqueueOutcomeKind = JobEnqueueResult["outcome"];

type ClaimScriptResult =
  "claimed" | "already_present" | "in_flight" | "steal" | "retry";

const ACQUIRE_ENQUEUE_CLAIM = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 'already_present'
end
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
  return 'claimed'
end
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 'already_present'
end
local pttl = redis.call('PTTL', KEYS[1])
if pttl > tonumber(ARGV[3]) then
  return 'in_flight'
end
if redis.call('GET', KEYS[1]) == false then
  return 'retry'
end
redis.call('DEL', KEYS[1])
return 'steal'
`;

export async function enqueueWithTransportClaim(
  queue: Queue,
  jobId: string,
  add: () => Promise<void>,
  testHooks: EnqueueClaimTestHooksInput = undefined,
): Promise<EnqueueOutcomeKind> {
  await queue.waitUntilReady();
  const client = await queue.client;
  const claimKey = `${queue.toKey("osva-enqueue-claim")}:${jobId}`;
  const jobKey = `${queue.toKey("")}${jobId}`;
  const hookContext = { jobId, claimKey, jobKey };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await testHooks?.beforeClaim?.(hookContext);
    const token = randomUUID();
    const result = (await client.eval(
      ACQUIRE_ENQUEUE_CLAIM,
      2,
      claimKey,
      jobKey,
      token,
      String(ENQUEUE_CLAIM_TTL_SECONDS),
      String(ENQUEUE_CLAIM_IN_FLIGHT_PTTL_MS),
    )) as ClaimScriptResult;

    if (result === "already_present" || result === "in_flight") {
      return "already_present";
    }

    if (result === "retry" || result === "steal") {
      continue;
    }

    if (result !== "claimed") {
      throw new Error(`Unexpected enqueue claim script result: ${result}`);
    }

    try {
      await testHooks?.afterClaimBeforeAdd?.(hookContext);
      await add();
      await testHooks?.afterAddBeforeReturn?.(hookContext);
      return "enqueued";
    } catch (error) {
      await client.del(claimKey).catch(() => undefined);
      throw error;
    }
  }

  return "already_present";
}
