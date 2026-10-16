import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { HELLO_STATE_SCHEMA_VERSION, packageRootDir } from "./constants.js";

export interface HelloAgentState {
  readonly schemaVersion: typeof HELLO_STATE_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly manifestFingerprint: string;
  readonly integrity: string;
  readonly updatedAt: string;
}

const SECRET_KEY_PATTERN = /api[_-]?key|secret|password|token|authorization/i;

export class HelloStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelloStateError";
  }
}

function stateFilePath(): string {
  return path.join(packageRootDir, ".osva", "hello-agent-state.json");
}

export function assertStateHasNoSecrets(state: HelloAgentState): void {
  const serialized = JSON.stringify(state);
  if (SECRET_KEY_PATTERN.test(serialized)) {
    throw new HelloStateError(
      "Refusing to persist state containing secret-like keys.",
    );
  }
}

export async function readHelloState(): Promise<HelloAgentState | null> {
  try {
    const raw = await readFile(stateFilePath(), "utf8");
    const parsed = JSON.parse(raw) as HelloAgentState;
    if (parsed.schemaVersion !== HELLO_STATE_SCHEMA_VERSION) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function writeHelloState(state: HelloAgentState): Promise<void> {
  assertStateHasNoSecrets(state);
  await mkdir(path.dirname(stateFilePath()), { recursive: true });
  await writeFile(
    stateFilePath(),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}
