import path from "node:path";

import { readInstallEnvFile } from "./env-file.js";
import { assessInstallDirectory } from "./installation-state.js";
import { DEFAULT_PUBLISH_PORTS } from "./port-selection.js";
import {
  selectAvailablePublishPorts,
  type PortSelectionResult,
  type PublishPortAssignment,
} from "./port-selection.js";
import type { SetupOptions } from "./read-options.js";
import type { ComposeExecContext } from "./compose-exec.js";
import { readPreflightComposeContext } from "./compose-preflight-context.js";
import { assessLoopbackPortOwnership } from "./port-ownership.js";
import type { ProbeSpawnFn } from "./probe-spawn.js";
import type { LoopbackPortProbeFn } from "./run-setup.js";
import { probeLoopbackPortAvailability } from "./run-setup.js";
import {
  PUBLISH_SERVICE_ENV_KEYS,
  type PublishServiceKey,
} from "./publish-port-keys.js";

export interface ExplicitPublishPortFlags {
  readonly web: boolean;
  readonly mcp: boolean;
  readonly console: boolean;
  readonly runtime: boolean;
}

export function readExplicitPublishPortFlags(
  flags: Readonly<Record<string, string | boolean>>,
  env: NodeJS.ProcessEnv,
): ExplicitPublishPortFlags {
  return {
    web: portExplicitlyRequested(flags["web-port"], env.OSVA_PUBLISH_WEB_PORT),
    mcp: portExplicitlyRequested(flags["mcp-port"], env.OSVA_PUBLISH_MCP_PORT),
    console: portExplicitlyRequested(
      flags["console-port"],
      env.OSVA_PUBLISH_CONSOLE_PORT,
    ),
    runtime: portExplicitlyRequested(
      flags["runtime-capability-port"],
      env.OSVA_PUBLISH_RUNTIME_CAPABILITY_PORT ??
        env.OSVA_RUNTIME_CAPABILITY_PORT,
    ),
  };
}

function portExplicitlyRequested(
  flagValue: string | boolean | undefined,
  envValue: string | undefined,
): boolean {
  if (typeof flagValue === "string" && flagValue.trim().length > 0) {
    return true;
  }
  const trimmed = envValue?.trim();
  return trimmed !== undefined && trimmed.length > 0;
}

export async function mergePersistedInstallationPorts(
  options: SetupOptions,
  explicit: ExplicitPublishPortFlags,
): Promise<SetupOptions> {
  const envPath = path.join(options.installDir, ".env");
  const installEnv = await readInstallEnvFile(envPath);
  if (installEnv === undefined) {
    return options;
  }
  const assessment = await assessInstallDirectory(options.installDir);
  if (assessment.kind !== "osva_installation") {
    return options;
  }

  const webPort = pickPort(
    options.webPort,
    explicit.web,
    installEnv.get(PUBLISH_SERVICE_ENV_KEYS.web),
    DEFAULT_PUBLISH_PORTS.web,
  );
  const mcpPort = pickPort(
    options.mcpPort,
    explicit.mcp,
    installEnv.get(PUBLISH_SERVICE_ENV_KEYS.mcp),
    DEFAULT_PUBLISH_PORTS.mcp,
  );
  const consolePort = pickPort(
    options.consolePort,
    explicit.console,
    installEnv.get(PUBLISH_SERVICE_ENV_KEYS.console),
    DEFAULT_PUBLISH_PORTS.console,
  );
  const runtimeCapabilityPort = pickPort(
    options.runtimeCapabilityPort,
    explicit.runtime,
    installEnv.get(PUBLISH_SERVICE_ENV_KEYS.runtime),
    DEFAULT_PUBLISH_PORTS.runtimeCapability,
  );

  return {
    ...options,
    webPort,
    mcpPort,
    consolePort,
    runtimeCapabilityPort,
  };
}

function pickPort(
  requested: number,
  explicit: boolean,
  persisted: string | undefined,
  defaultPort: number,
): number {
  if (explicit) {
    return requested;
  }
  if (persisted !== undefined && persisted.length > 0) {
    const parsed = Number.parseInt(persisted, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535) {
      return parsed;
    }
  }
  if (requested !== defaultPort) {
    return requested;
  }
  return requested;
}

export async function resolveAutoPublishPorts(input: {
  readonly options: SetupOptions;
  readonly explicit: ExplicitPublishPortFlags;
  readonly probe?: LoopbackPortProbeFn;
  readonly autoPorts: boolean;
  readonly spawn?: ProbeSpawnFn;
}): Promise<{
  readonly options: SetupOptions;
  readonly selection?: PortSelectionResult;
}> {
  const probe = input.probe ?? probeLoopbackPortAvailability;
  const allowRenumber = buildAllowRenumberMap(input.explicit, input.autoPorts);
  const execCtx = await readPreflightComposeContext(input.options);

  const needsAnyAuto =
    input.autoPorts &&
    (Object.entries(allowRenumber) as [PublishServiceKey, boolean][]).some(
      ([service, allowed]) =>
        allowed && (service !== "runtime" || input.options.remoteHttpDev),
    );

  if (!needsAnyAuto) {
    await assertExplicitPortsAvailable({
      options: input.options,
      explicit: input.explicit,
      probe,
      spawn: input.spawn,
      execCtx,
    });
    return { options: input.options };
  }

  const preselected = await selectAvailablePublishPorts({
    requested: toAssignment(input.options),
    includeRuntimeCapability: input.options.remoteHttpDev,
    reserved: new Set(),
    probe,
    allowRenumber: {
      webPort: allowRenumber.web,
      mcpPort: allowRenumber.mcp,
      consolePort: allowRenumber.console,
      runtimeCapabilityPort:
        input.options.remoteHttpDev && allowRenumber.runtime,
    },
  });

  return {
    options: {
      ...input.options,
      ...preselected.assignment,
    },
    selection: preselected,
  };
}

async function assertExplicitPortsAvailable(input: {
  readonly options: SetupOptions;
  readonly explicit: ExplicitPublishPortFlags;
  readonly probe: LoopbackPortProbeFn;
  readonly spawn?: ProbeSpawnFn;
  readonly execCtx?: ComposeExecContext;
}): Promise<void> {
  const checks: {
    readonly label: string;
    readonly service: PublishServiceKey;
    readonly port: number;
    readonly required: boolean;
  }[] = [
    {
      label: "web",
      service: "web",
      port: input.options.webPort,
      required: input.explicit.web,
    },
    {
      label: "mcp",
      service: "mcp",
      port: input.options.mcpPort,
      required: input.explicit.mcp,
    },
    {
      label: "console",
      service: "console",
      port: input.options.consolePort,
      required: input.explicit.console,
    },
    ...(input.options.remoteHttpDev
      ? [
          {
            label: "runtime capability",
            service: "runtime" as const,
            port: input.options.runtimeCapabilityPort,
            required: input.explicit.runtime,
          },
        ]
      : []),
  ];

  for (const entry of checks) {
    if (!entry.required) {
      continue;
    }
    const result = await input.probe(entry.port);
    if (result.kind === "available") {
      continue;
    }
    if (result.kind === "in_use") {
      const ownership = await assessLoopbackPortOwnership({
        port: entry.port,
        installDir: input.options.installDir,
        service: entry.service,
        probeInUse: true,
        expectedProjectName: input.execCtx?.projectName,
        execCtx: input.execCtx,
        spawn: input.spawn,
      });
      if (ownership.ownership === "this_installation") {
        if (input.options.authorizeExisting) {
          continue;
        }
        throw new Error(
          `Explicit ${entry.label} port ${String(entry.port)} is in use by this installation's Compose project. Re-run with --yes to reconcile without changing explicit ports. ${ownership.detail ?? ""}`.trim(),
        );
      }
      const remediation =
        ownership.ownership === "other_osva_installation"
          ? "Stop the other OSVA installation or choose different explicit ports."
          : ownership.ownership === "foreign_application"
            ? "Free the port or choose different explicit --web-port / --mcp-port / --console-port values."
            : ownership.ownership === "unknown"
              ? "Ensure this installation's platform services are running (`osva platform start`) so Compose ownership can be verified, or stop the conflicting listener."
              : input.options.authorizeExisting
                ? "Re-run without --yes on a fresh directory, or use --auto-ports when the occupied port is not owned by this installation."
                : "Free the port, pass --yes to reconcile an existing installation, or use --auto-ports.";
      throw new Error(
        `Explicit ${entry.label} port ${String(entry.port)} is not available on 127.0.0.1 (${ownership.ownership}). ${ownership.detail ?? ""} ${remediation}`.trim(),
      );
    }
    throw new Error(
      `Explicit ${entry.label} port ${String(entry.port)} is not available on 127.0.0.1.`,
    );
  }
}

export function toAssignment(options: SetupOptions): PublishPortAssignment {
  return {
    webPort: options.webPort,
    mcpPort: options.mcpPort,
    consolePort: options.consolePort,
    runtimeCapabilityPort: options.runtimeCapabilityPort,
  };
}

export function explicitPublishPortMessage(
  selection: PortSelectionResult | undefined,
): string | undefined {
  if (selection === undefined || selection.renumbered.length === 0) {
    return undefined;
  }
  return selection.renumbered
    .map(
      (entry) => `${entry.label} ${String(entry.from)} → ${String(entry.to)}`,
    )
    .join(", ");
}

export function buildAllowRenumberMap(
  explicit: ExplicitPublishPortFlags,
  autoPorts: boolean,
): Record<PublishServiceKey, boolean> {
  if (!autoPorts) {
    return {
      web: false,
      mcp: false,
      console: false,
      runtime: false,
    };
  }
  return {
    web: !explicit.web,
    mcp: !explicit.mcp,
    console: !explicit.console,
    runtime: !explicit.runtime,
  };
}
