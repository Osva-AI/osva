import {
  buildComposeSpawnEnv,
  runComposeCommand,
  type ComposeExecContext,
} from "../setup/compose-exec.js";
import type { ProbeSpawnFn } from "../setup/probe-spawn.js";
import {
  type ComposeServiceSnapshot,
  type ServiceRuntimeState,
} from "./types.js";

export const COMPOSE_INSPECT_TIMEOUT_MS = 120_000;

interface ComposePsRow {
  readonly Service?: string;
  readonly Name?: string;
  readonly State?: string;
  readonly Status?: string;
  readonly Health?: string;
}

export function inspectComposeServices(
  ctx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): readonly ComposeServiceSnapshot[] {
  const result = runComposeCommand(ctx, ["ps", "-a", "--format", "json"], {
    spawn,
    timeoutMs: COMPOSE_INSPECT_TIMEOUT_MS,
    processEnv: buildComposeSpawnEnv(ctx),
  });
  if (result.status !== 0) {
    return [];
  }
  return parseComposePsJson(result.stdout);
}

export function parseComposePsJson(stdout: string): ComposeServiceSnapshot[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const rows: ComposePsRow[] = [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as ComposePsRow[];
      rows.push(...parsed);
    } catch {
      return [];
    }
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate.length === 0) {
        continue;
      }
      try {
        rows.push(JSON.parse(candidate) as ComposePsRow);
      } catch {
        // ignore malformed lines
      }
    }
  }

  const byService = new Map<string, ComposeServiceSnapshot>();
  for (const row of rows) {
    const name = row.Service?.trim();
    if (name === undefined || name.length === 0) {
      continue;
    }
    byService.set(name, mapComposePsRow(name, row));
  }
  return [...byService.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function mapComposePsRow(
  name: string,
  row: ComposePsRow,
): ComposeServiceSnapshot {
  const statusText = row.Status?.trim() || row.State?.trim() || "unknown";
  const health = row.Health?.trim();
  return {
    name,
    state: classifyServiceState(statusText, health),
    statusText,
    health: health && health.length > 0 ? health : undefined,
  };
}

export function classifyServiceState(
  statusText: string,
  health: string | undefined,
): ServiceRuntimeState {
  const normalized = statusText.toLowerCase();
  if (normalized.includes("exited") || normalized.includes("dead")) {
    return "stopped";
  }
  if (health !== undefined) {
    const healthLower = health.toLowerCase();
    if (healthLower.includes("unhealthy")) {
      return "unhealthy";
    }
    if (healthLower.includes("healthy")) {
      return "healthy";
    }
    if (healthLower.includes("starting")) {
      return "starting";
    }
  }
  if (normalized.includes("(unhealthy)")) {
    return "unhealthy";
  }
  if (normalized.includes("(healthy)")) {
    return "healthy";
  }
  if (normalized.includes("starting") || normalized.includes("created")) {
    return "starting";
  }
  if (
    normalized.includes("running") ||
    normalized.includes("up") ||
    normalized.includes("restarting")
  ) {
    return normalized.includes("health: starting") ? "starting" : "running";
  }
  return "unknown";
}

export function migrateJobCompleted(
  services: readonly ComposeServiceSnapshot[],
): boolean | undefined {
  const migrate = services.find((service) => service.name === "migrate");
  if (migrate === undefined) {
    return undefined;
  }
  const status = migrate.statusText.toLowerCase();
  if (status.includes("exited") && status.includes("(0)")) {
    return true;
  }
  if (status.includes("exited") && !status.includes("(0)")) {
    return false;
  }
  if (migrate.state === "running" || migrate.state === "starting") {
    return false;
  }
  return undefined;
}
