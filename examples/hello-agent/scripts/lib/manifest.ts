import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentManifestV1, JsonSchemaRecord } from "@osva-ai/contracts";
import { AGENT_EXECUTION_DEFAULT_TIMEOUT_MS } from "@osva-ai/contracts";

import {
  contractsDir,
  HELLO_AGENT_ENTRYPOINT,
  HELLO_AGENT_KEY,
  HELLO_AGENT_NAME,
} from "./constants.js";

async function loadJsonSchema(fileName: string): Promise<JsonSchemaRecord> {
  const raw = await readFile(path.join(contractsDir, fileName), "utf8");
  return JSON.parse(raw) as JsonSchemaRecord;
}

export async function buildHelloAgentManifest(input: {
  readonly integrity: string;
}): Promise<AgentManifestV1> {
  return {
    schemaVersion: "1",
    key: HELLO_AGENT_KEY,
    name: HELLO_AGENT_NAME,
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint: HELLO_AGENT_ENTRYPOINT,
      integrity: input.integrity,
    },
    input: { schema: await loadJsonSchema("input.v1.schema.json") },
    output: { schema: await loadJsonSchema("output.v1.schema.json") },
    execution: {
      timeoutMs: AGENT_EXECUTION_DEFAULT_TIMEOUT_MS,
      maxAttempts: 1,
    },
    capabilities: { model: false, tools: [] },
  };
}

/**
 * Canonical JSON for immutable manifest comparison. Matches OSVA persistence
 * checks (see AgentVersion mapper / jsonValuesEqual): property order must not
 * affect equivalence.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function manifestFingerprint(manifest: AgentManifestV1): string {
  const runtime = manifest.runtime;
  if (runtime.type !== "TRUSTED_TYPESCRIPT") {
    throw new Error("Hello Agent manifest must use TRUSTED_TYPESCRIPT.");
  }
  return canonicalJson(manifest);
}

export function manifestsMatch(
  left: AgentManifestV1,
  right: AgentManifestV1,
): boolean {
  return manifestFingerprint(left) === manifestFingerprint(right);
}
