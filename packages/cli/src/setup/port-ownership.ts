import path from "node:path";

import {
  buildComposeSpawnEnv,
  runComposeCommand,
  type ComposeExecContext,
} from "./compose-exec.js";
import { readInstallEnvFile } from "./env-file.js";
import {
  PUBLISH_SERVICE_ENV_KEYS,
  type PublishServiceKey,
} from "./publish-port-keys.js";
import { defaultProbeSpawn, type ProbeSpawnFn } from "./probe-spawn.js";
import {
  INSTALLATION_MARKER_RELATIVE,
  readInstallationMarker,
} from "./installation-state.js";

export type LoopbackPortOwnership =
  | "available"
  | "this_installation"
  | "other_osva_installation"
  | "foreign_application"
  | "unknown";

export interface PortOwnershipAssessment {
  readonly ownership: LoopbackPortOwnership;
  readonly detail?: string;
  readonly composeProjectName?: string;
}

export async function assessLoopbackPortOwnership(input: {
  readonly port: number;
  readonly installDir: string;
  readonly service: PublishServiceKey;
  readonly probeInUse: boolean;
  readonly expectedProjectName?: string;
  readonly execCtx?: ComposeExecContext;
  readonly spawn?: ProbeSpawnFn;
}): Promise<PortOwnershipAssessment> {
  if (!input.probeInUse) {
    return { ownership: "available" };
  }

  const publishers = input.execCtx
    ? await listComposePublishedLoopbackPorts(input.execCtx, input.spawn)
    : [];

  const boundHere = publishers.filter(
    (entry) =>
      entry.hostPort === input.port &&
      (input.expectedProjectName === undefined ||
        entry.projectName === input.expectedProjectName),
  );
  if (boundHere.length > 0) {
    return {
      ownership: "this_installation",
      composeProjectName: boundHere[0]?.projectName,
      detail: `Compose publishes 127.0.0.1:${String(input.port)} for project ${boundHere[0]?.projectName ?? "unknown"} (${boundHere[0]?.service ?? "service"}).`,
    };
  }

  const boundOtherOsva = publishers.filter(
    (entry) => entry.hostPort === input.port,
  );
  if (boundOtherOsva.length > 0) {
    return {
      ownership: "other_osva_installation",
      composeProjectName: boundOtherOsva[0]?.projectName,
      detail: `Port ${String(input.port)} is published by Compose project ${boundOtherOsva[0]?.projectName ?? "unknown"} (${boundOtherOsva[0]?.service ?? "service"}).`,
    };
  }

  const envPath = path.join(input.installDir, ".env");
  const envFile = await readInstallEnvFile(envPath);
  const envKey = PUBLISH_SERVICE_ENV_KEYS[input.service];
  const configured = envFile?.get(envKey);
  const markerPath = path.join(input.installDir, INSTALLATION_MARKER_RELATIVE);
  const marker = await readInstallationMarker(markerPath);

  if (configured === String(input.port) && marker !== undefined) {
    const projectMatches =
      input.expectedProjectName === undefined ||
      input.expectedProjectName === marker.composeProjectName;
    if (projectMatches && input.execCtx !== undefined) {
      const verified = await verifyProjectHostPortViaContainerInspect({
        port: input.port,
        service: input.service,
        execCtx: input.execCtx,
        expectedProjectName: marker.composeProjectName,
        spawn: input.spawn,
      });
      if (verified !== undefined) {
        return verified;
      }
    }
    return {
      ownership: "unknown",
      composeProjectName: marker.composeProjectName,
      detail:
        "Port matches this installation .env but Docker could not verify the host port binding for this Compose project (missing publisher metadata or container inspect evidence).",
    };
  }

  if (configured === String(input.port)) {
    return {
      ownership: "foreign_application",
      detail: `Port ${String(input.port)} matches ${envKey} in .env but installation marker is missing.`,
    };
  }

  return {
    ownership: "foreign_application",
    detail: `Loopback port ${String(input.port)} is in use by a non-Compose or unknown process.`,
  };
}

interface ComposePortPublisher {
  readonly hostPort: number;
  readonly projectName: string;
  readonly service: string;
}

export async function listComposePublishedLoopbackPorts(
  execCtx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): Promise<readonly ComposePortPublisher[]> {
  const result = runComposeCommand(execCtx, ["ps", "-a", "--format", "json"], {
    spawn,
    timeoutMs: 60_000,
    processEnv: buildComposeSpawnEnv(execCtx),
  });
  if (result.status !== 0) {
    return [];
  }
  return parseComposePsPublishers(result.stdout, execCtx.projectName);
}

export function parseComposePsPublishers(
  stdout: string,
  defaultProjectName: string | undefined,
): ComposePortPublisher[] {
  const rows = parseComposePsRows(stdout);
  const publishers: ComposePortPublisher[] = [];
  for (const row of rows) {
    const service = row.Service?.trim() ?? row.service?.trim() ?? "";
    const project =
      row.Project?.trim() ??
      row.project?.trim() ??
      defaultProjectName ??
      inferProjectFromName(row.Name ?? row.name);
    const publishersField =
      row.Publishers ?? row.publishers ?? row.Ports ?? row.ports ?? "";
    for (const hostPort of extractLoopbackHostPorts(String(publishersField))) {
      publishers.push({
        hostPort,
        projectName: project ?? "unknown",
        service,
      });
    }
  }
  return publishers;
}

interface ComposePsGenericRow {
  readonly ID?: string;
  readonly Id?: string;
  readonly id?: string;
  readonly Service?: string;
  readonly service?: string;
  readonly Name?: string;
  readonly name?: string;
  readonly Project?: string;
  readonly project?: string;
  readonly Publishers?: unknown;
  readonly publishers?: unknown;
  readonly Ports?: unknown;
  readonly ports?: unknown;
}

function parseComposePsRows(stdout: string): ComposePsGenericRow[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as ComposePsGenericRow[];
    } catch {
      return [];
    }
  }
  const rows: ComposePsGenericRow[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate.length === 0) {
      continue;
    }
    try {
      rows.push(JSON.parse(candidate) as ComposePsGenericRow);
    } catch {
      // ignore
    }
  }
  return rows;
}

function inferProjectFromName(name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const match = /^([^_-]+)[_-]/.exec(name);
  return match?.[1];
}

interface ComposeContainerRow {
  readonly id: string;
  readonly service: string;
  readonly projectName: string;
}

const INSPECT_PUBLISH_SERVICES: readonly PublishServiceKey[] = [
  "web",
  "mcp",
  "console",
  "runtime",
];

async function verifyProjectHostPortViaContainerInspect(input: {
  readonly port: number;
  readonly service: PublishServiceKey;
  readonly execCtx: ComposeExecContext;
  readonly expectedProjectName: string;
  readonly spawn: ProbeSpawnFn | undefined;
}): Promise<PortOwnershipAssessment | undefined> {
  const spawn = input.spawn ?? defaultProbeSpawn;
  const containers = await listComposeProjectContainers(
    input.execCtx,
    input.spawn,
  );
  const foreignBindings: ComposeContainerRow[] = [];

  for (const container of containers) {
    const hostPorts = await readContainerLoopbackHostPorts(container.id, spawn);
    if (!hostPorts.includes(input.port)) {
      continue;
    }
    if (
      container.projectName === input.expectedProjectName &&
      (container.service === input.service ||
        INSPECT_PUBLISH_SERVICES.includes(
          container.service as PublishServiceKey,
        ))
    ) {
      return {
        ownership: "this_installation",
        composeProjectName: container.projectName,
        detail: `Docker container ${container.id.slice(0, 12)} (${container.service}) in Compose project ${container.projectName} publishes host port ${String(input.port)}.`,
      };
    }
    foreignBindings.push(container);
  }

  const globalOwner = await findPublishedPortOwnerViaDockerPs(
    input.port,
    spawn,
  );
  if (globalOwner !== undefined) {
    const ownerInThisProject = containers.some(
      (container) =>
        container.projectName === input.expectedProjectName &&
        containerIdsMatch(container.id, globalOwner.containerId),
    );
    if (ownerInThisProject) {
      return {
        ownership: "this_installation",
        composeProjectName: input.expectedProjectName,
        detail: `Docker container ${globalOwner.containerId.slice(0, 12)} publishes host port ${String(input.port)} for Compose project ${input.expectedProjectName}.`,
      };
    }
    if (globalOwner.projectName === input.expectedProjectName) {
      return {
        ownership: "this_installation",
        composeProjectName: globalOwner.projectName,
        detail: `Docker reports Compose project ${globalOwner.projectName} (${globalOwner.service ?? "service"}) publishing host port ${String(input.port)}.`,
      };
    }
    if (globalOwner.projectName.startsWith("osva-")) {
      return {
        ownership: "other_osva_installation",
        composeProjectName: globalOwner.projectName,
        detail: `Host port ${String(input.port)} is published by OSVA Compose project ${globalOwner.projectName}.`,
      };
    }
    return {
      ownership: "foreign_application",
      detail: `Host port ${String(input.port)} is published by ${globalOwner.projectName || "another"} container ${globalOwner.containerId.slice(0, 12)}.`,
    };
  }

  if (foreignBindings.length > 0) {
    return {
      ownership: "unknown",
      composeProjectName: input.expectedProjectName,
      detail:
        "Containers in this Compose project are running but none expose the configured host port in Docker inspect metadata.",
    };
  }

  return undefined;
}

async function listComposeProjectContainers(
  execCtx: ComposeExecContext,
  spawn: ProbeSpawnFn | undefined,
): Promise<readonly ComposeContainerRow[]> {
  const result = runComposeCommand(execCtx, ["ps", "-a", "--format", "json"], {
    spawn,
    timeoutMs: 60_000,
    processEnv: buildComposeSpawnEnv(execCtx),
  });
  if (result.status !== 0) {
    return [];
  }
  const rows = parseComposePsRows(result.stdout);
  const containers: ComposeContainerRow[] = [];
  for (const row of rows) {
    const id = String(row.ID ?? row.Id ?? row.id ?? "").trim();
    if (id.length === 0) {
      continue;
    }
    const service = row.Service?.trim() ?? row.service?.trim() ?? "";
    const project =
      row.Project?.trim() ??
      row.project?.trim() ??
      execCtx.projectName ??
      "unknown";
    containers.push({ id, service, projectName: project });
  }
  return containers;
}

async function readContainerLoopbackHostPorts(
  containerId: string,
  spawn: ProbeSpawnFn,
): Promise<readonly number[]> {
  const result = spawn(
    "docker",
    ["inspect", containerId, "--format", "{{json .NetworkSettings.Ports}}"],
    60_000,
  );
  if (result.status !== 0) {
    return [];
  }
  return parseDockerNetworkSettingsPorts(result.stdout);
}

export function parseDockerNetworkSettingsPorts(stdout: string): number[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0 || trimmed === "null") {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<
      string,
      readonly { HostIp?: string; HostPort?: string }[] | undefined
    >;
    const ports = new Set<number>();
    for (const bindings of Object.values(parsed)) {
      if (bindings === undefined) {
        continue;
      }
      for (const binding of bindings) {
        const hostIp = binding.HostIp?.trim() ?? "";
        if (
          hostIp.length > 0 &&
          hostIp !== "127.0.0.1" &&
          hostIp !== "0.0.0.0" &&
          hostIp !== "::1" &&
          hostIp !== "::" &&
          !hostIp.startsWith("::ffff:127.")
        ) {
          continue;
        }
        const raw = binding.HostPort?.trim();
        if (raw === undefined || raw.length === 0) {
          continue;
        }
        const port = Number.parseInt(raw, 10);
        if (Number.isInteger(port) && port >= 1 && port <= 65_535) {
          ports.add(port);
        }
      }
    }
    return [...ports];
  } catch {
    return [];
  }
}

function containerIdsMatch(composePsId: string, dockerPsId: string): boolean {
  const a = composePsId.trim().toLowerCase();
  const b = dockerPsId.trim().toLowerCase();
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  return a === b || a.startsWith(b) || b.startsWith(a);
}

async function findPublishedPortOwnerViaDockerPs(
  port: number,
  spawn: ProbeSpawnFn,
): Promise<
  | {
      readonly containerId: string;
      readonly projectName: string;
      readonly service?: string;
    }
  | undefined
> {
  const result = spawn("docker", ["ps", "--format", "{{json .}}"], 60_000);
  if (result.status !== 0) {
    return undefined;
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const row = JSON.parse(trimmed) as {
        readonly ID?: string;
        readonly Names?: string;
        readonly Ports?: string;
        readonly Labels?: Record<string, string>;
      };
      const id = row.ID?.trim();
      const portsField = row.Ports ?? "";
      const published = extractLoopbackHostPorts(String(portsField));
      if (id === undefined || !published.includes(port)) {
        continue;
      }
      const labels = row.Labels ?? {};
      return {
        containerId: id,
        projectName:
          labels["com.docker.compose.project"] ??
          labels["com.docker.compose.project.working_dir"] ??
          "",
        service: labels["com.docker.compose.service"],
      };
    } catch {
      // ignore line
    }
  }
  return undefined;
}

export function extractLoopbackHostPorts(published: string): number[] {
  const ports: number[] = [];
  const hostPattern = /(?:127\.0\.0\.1|0\.0\.0\.0|localhost|::1):(\d+)->/gi;
  let match: RegExpExecArray | null;
  while ((match = hostPattern.exec(published)) !== null) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isInteger(parsed)) {
      ports.push(parsed);
    }
  }
  if (ports.length > 0) {
    return ports;
  }
  try {
    const json = JSON.parse(published) as unknown;
    if (Array.isArray(json)) {
      for (const entry of json) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          "PublishedPort" in entry &&
          "URL" in entry
        ) {
          const url = String((entry as { URL: string }).URL);
          const urlMatch = /127\.0\.0\.1:(\d+)/.exec(url);
          if (urlMatch !== null) {
            const parsed = Number.parseInt(urlMatch[1] ?? "", 10);
            if (Number.isInteger(parsed)) {
              ports.push(parsed);
            }
          }
        }
      }
    }
  } catch {
    // not json
  }
  return ports;
}
