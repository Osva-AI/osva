import path from "node:path";

import { writeFileAtomic } from "./atomic-write.js";
import {
  buildInstallEnvValues,
  installEnvValuesFromEnvMap,
  readInstallEnvFile,
  renderInstallEnvFile,
} from "./env-file.js";
import { resolveSetupImageRef } from "./acceptance-install.js";
import type { ComposeDistribution } from "./distribution.js";
import type { PortSelectionResult } from "./port-selection.js";
import type { SetupOptions } from "./read-options.js";

export interface RefreshInstallationPublishPortsResult {
  readonly options: SetupOptions;
  readonly envPath: string;
  readonly selectionMessage: string | undefined;
}

export async function refreshInstallationPublishPorts(input: {
  readonly installDir: string;
  readonly options: SetupOptions;
  readonly selection: PortSelectionResult;
  readonly distribution: ComposeDistribution;
  readonly processEnv: NodeJS.ProcessEnv;
}): Promise<RefreshInstallationPublishPortsResult> {
  const envPath = path.join(input.installDir, ".env");
  const existingEnv = await readInstallEnvFile(envPath);
  if (existingEnv === undefined) {
    throw new Error(`Installation .env is missing at ${envPath}.`);
  }
  const previous = installEnvValuesFromEnvMap(existingEnv);
  const assignment = input.selection.assignment;

  const envValues = buildInstallEnvValues({
    imageRef: resolveSetupImageRef({
      distributionImageRef: input.distribution.manifest.imageRef,
      processEnv: input.processEnv,
    }),
    composeProjectName: previous.COMPOSE_PROJECT_NAME,
    webPort: assignment.webPort,
    mcpPort: assignment.mcpPort,
    consolePort: assignment.consolePort,
    runtimeCapabilityPort: assignment.runtimeCapabilityPort,
    remoteHttpDevProfile: input.options.remoteHttpDev,
    existing: existingEnv,
    generateSecret: () => {
      throw new Error("Secret generation is forbidden during port refresh.");
    },
    refreshPublishedOrigins: true,
  });

  if (envValues.POSTGRES_PASSWORD !== previous.POSTGRES_PASSWORD) {
    throw new Error("Port refresh must not rotate POSTGRES_PASSWORD.");
  }
  if (envValues.OSVA_AUTH_SECRET !== previous.OSVA_AUTH_SECRET) {
    throw new Error("Port refresh must not rotate OSVA_AUTH_SECRET.");
  }
  if (envValues.COMPOSE_PROJECT_NAME !== previous.COMPOSE_PROJECT_NAME) {
    throw new Error("Port refresh must not change COMPOSE_PROJECT_NAME.");
  }

  await writeFileAtomic(envPath, renderInstallEnvFile(envValues), {
    restrictPermissions: true,
  });

  const options: SetupOptions = {
    ...input.options,
    webPort: assignment.webPort,
    mcpPort: assignment.mcpPort,
    consolePort: assignment.consolePort,
    runtimeCapabilityPort: assignment.runtimeCapabilityPort,
  };

  const selectionMessage =
    input.selection.renumbered.length > 0
      ? input.selection.renumbered
          .map(
            (entry) =>
              `${entry.label} ${String(entry.from)} → ${String(entry.to)}`,
          )
          .join(", ")
      : undefined;

  return { options, envPath, selectionMessage };
}
