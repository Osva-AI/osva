import type { LoopbackPortProbeFn } from "./run-setup.js";
import { probeLoopbackPortAvailability } from "./run-setup.js";

export const DEFAULT_PUBLISH_PORTS = {
  web: 8080,
  mcp: 3100,
  console: 4174,
  runtimeCapability: 8787,
} as const;

export interface PublishPortAssignment {
  readonly webPort: number;
  readonly mcpPort: number;
  readonly consolePort: number;
  readonly runtimeCapabilityPort: number;
}

export interface PortSelectionInput {
  readonly requested: PublishPortAssignment;
  readonly includeRuntimeCapability: boolean;
  readonly reserved: ReadonlySet<number>;
  readonly probe?: LoopbackPortProbeFn;
  readonly allowRenumber?: Partial<
    Record<keyof PublishPortAssignment, boolean>
  >;
}

export interface PortSelectionResult {
  readonly assignment: PublishPortAssignment;
  readonly renumbered: readonly {
    readonly label: keyof PublishPortAssignment;
    readonly from: number;
    readonly to: number;
  }[];
}

const SEARCH_MAX = 200;

export async function selectAvailablePublishPorts(
  input: PortSelectionInput,
): Promise<PortSelectionResult> {
  const probe = input.probe ?? probeLoopbackPortAvailability;
  const used = new Set(input.reserved);
  const renumbered: {
    label: keyof PublishPortAssignment;
    from: number;
    to: number;
  }[] = [];

  async function resolve(
    label: keyof PublishPortAssignment,
    requested: number,
    allowRenumber: boolean,
  ): Promise<number> {
    const available = await findAvailablePort(
      requested,
      used,
      probe,
      allowRenumber,
    );
    used.add(available);
    if (available !== requested) {
      renumbered.push({ label, from: requested, to: available });
    }
    return available;
  }

  const allow = input.allowRenumber ?? {};
  const webPort = await resolve(
    "webPort",
    input.requested.webPort,
    allow.webPort ?? true,
  );
  const mcpPort = await resolve(
    "mcpPort",
    input.requested.mcpPort,
    allow.mcpPort ?? true,
  );
  const consolePort = await resolve(
    "consolePort",
    input.requested.consolePort,
    allow.consolePort ?? true,
  );
  const runtimeCapabilityPort = input.includeRuntimeCapability
    ? await resolve(
        "runtimeCapabilityPort",
        input.requested.runtimeCapabilityPort,
        allow.runtimeCapabilityPort ?? true,
      )
    : input.requested.runtimeCapabilityPort;

  return {
    assignment: {
      webPort,
      mcpPort,
      consolePort,
      runtimeCapabilityPort,
    },
    renumbered,
  };
}

async function findAvailablePort(
  start: number,
  used: ReadonlySet<number>,
  probe: LoopbackPortProbeFn,
  allowRenumber: boolean,
): Promise<number> {
  const first = await probeOnce(start, used, probe);
  if (first !== undefined) {
    return first;
  }
  if (!allowRenumber) {
    throw new Error(`Port ${String(start)} is not available.`);
  }
  for (let offset = 1; offset <= SEARCH_MAX; offset += 1) {
    const candidate = start + offset;
    if (candidate > 65_535) {
      break;
    }
    const resolved = await probeOnce(candidate, used, probe);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  throw new Error(
    `Could not find a free loopback port near ${String(start)} within ${String(SEARCH_MAX)} attempts.`,
  );
}

async function probeOnce(
  port: number,
  used: ReadonlySet<number>,
  probe: LoopbackPortProbeFn,
): Promise<number | undefined> {
  if (used.has(port)) {
    return undefined;
  }
  const result = await probe(port);
  if (result.kind === "available") {
    return port;
  }
  return undefined;
}

export async function isLoopbackPortAvailable(
  port: number,
  probe: LoopbackPortProbeFn = probeLoopbackPortAvailability,
): Promise<boolean> {
  const result = await probe(port);
  return result.kind === "available";
}
