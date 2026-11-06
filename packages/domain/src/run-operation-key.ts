import { createHash } from "node:crypto";

import type { JsonValue, RunId } from "@osva-ai/contracts";

export function buildRunOperationKey(runId: RunId, toolCallId: string): string {
  return `${runId}:${toolCallId}`;
}

export function fingerprintToolInput(input: JsonValue): string {
  return createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
}
