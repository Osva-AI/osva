import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { stateFilePath } from "./paths.js";

export const CANONICAL_STATE_SCHEMA_VERSION = "1" as const;

export interface CanonicalToolState {
  readonly toolId: string;
  readonly toolVersionId: string;
}

export interface CanonicalAgentState {
  readonly agentId: string;
  readonly agentVersionId: string;
}

export interface CanonicalStateV1 {
  readonly schemaVersion: typeof CANONICAL_STATE_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly updatedAt?: string;

  readonly modelProfileId: string;
  readonly modelProfileVersionId: string;

  readonly policyArtifactId: string;
  readonly knowledgeSourceId: string;
  readonly knowledgeIndexId: string;

  readonly connectorId: string;
  readonly connectorVersionId: string;

  readonly tools: {
    readonly npmPackageMetadata: CanonicalToolState;
    readonly npmDownloads: CanonicalToolState;
  };

  readonly agents: {
    readonly research: CanonicalAgentState;
    readonly analysis: CanonicalAgentState;
    readonly report: CanonicalAgentState;
  };

  readonly workflowId: string;
  readonly workflowVersionId: string;

  readonly trustedRuntime: {
    readonly researchIntegrity: string;
    readonly analysisIntegrity: string;
    readonly reportIntegrity: string;
    readonly mcpStdioEntry: string;
  };
}

const SECRET_KEY_PATTERN = /api[_-]?key|secret|password|token|authorization/i;

export class SetupStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupStateError";
  }
}

export function assertStateHasNoSecrets(state: CanonicalStateV1): void {
  const serialized = JSON.stringify(state);
  if (SECRET_KEY_PATTERN.test(serialized)) {
    throw new SetupStateError(
      "Refusing to persist state containing secret-like keys.",
    );
  }
}

export async function readCanonicalState(): Promise<CanonicalStateV1 | null> {
  try {
    const raw = await readFile(stateFilePath(), "utf8");
    return parseCanonicalState(raw);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export function parseCanonicalState(raw: string): CanonicalStateV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SetupStateError(
      "Malformed canonical-state.json: file is not valid JSON.",
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SetupStateError(
      "Malformed canonical-state.json: root must be an object.",
    );
  }

  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== CANONICAL_STATE_SCHEMA_VERSION) {
    throw new SetupStateError(
      'Malformed canonical-state.json: schemaVersion must be "1".',
    );
  }

  const workspaceId = record.workspaceId;
  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    throw new SetupStateError(
      "Malformed canonical-state.json: workspaceId must be a non-empty string.",
    );
  }

  return {
    ...(record as unknown as CanonicalStateV1),
    workspaceId: workspaceId.trim().replace(/^\uFEFF/, ""),
  };
}

export async function writeCanonicalState(
  state: CanonicalStateV1,
): Promise<void> {
  assertStateHasNoSecrets(state);
  const target = stateFilePath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
