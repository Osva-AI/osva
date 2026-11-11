import type { ProbeSpawnResult } from "./probe-spawn.js";

const HOST_PORT_CONFLICT_PATTERNS = [
  /port is already allocated/i,
  /address already in use/i,
  /bind for .+ failed/i,
  /ports are not available/i,
  /failed to bind port/i,
  /listen tcp .+ bind: .+already in use/i,
] as const;

const LOOPBACK_PORT_IN_OUTPUT =
  /(?:127\.0\.0\.1|0\.0\.0\.0|localhost)[:\s]+(\d{2,5})\b/g;

export function composeOutputText(result: ProbeSpawnResult): string {
  return `${result.stderr}\n${result.stdout}`;
}

export function isComposeHostPortConflictOutput(output: string): boolean {
  const normalized = output.trim();
  if (normalized.length === 0) {
    return false;
  }
  return HOST_PORT_CONFLICT_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

export function parseHostPortsFromComposeConflictOutput(
  output: string,
): readonly number[] {
  const ports = new Set<number>();
  for (const match of output.matchAll(LOOPBACK_PORT_IN_OUTPUT)) {
    const raw = match[1];
    if (raw === undefined) {
      continue;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535) {
      ports.add(parsed);
    }
  }
  return [...ports];
}
