import { writeFile } from "node:fs/promises";

import { writeFileAtomic } from "./atomic-write.js";

export function acceptanceInstallEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.OSVA_ACCEPTANCE_INSTALL?.trim() === "1";
}

export function resolveSetupImageRef(input: {
  readonly distributionImageRef: string;
  readonly processEnv: NodeJS.ProcessEnv;
}): string {
  const override = input.processEnv.OSVA_SETUP_LOCAL_IMAGE?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return input.distributionImageRef;
}

export async function writeAcceptanceSetupTokenFile(input: {
  readonly processEnv: NodeJS.ProcessEnv;
  readonly token: string;
}): Promise<void> {
  if (!acceptanceInstallEnabled(input.processEnv)) {
    return;
  }
  const targetPath = input.processEnv.OSVA_SETUP_SETUP_TOKEN_FILE?.trim();
  if (targetPath === undefined || targetPath.length === 0) {
    return;
  }
  await writeFileAtomic(targetPath, `${input.token}\n`, {
    restrictPermissions: true,
  });
}

export async function writeAcceptanceBootstrapKeyFile(input: {
  readonly processEnv: NodeJS.ProcessEnv;
  readonly apiKey: string;
}): Promise<void> {
  if (!acceptanceInstallEnabled(input.processEnv)) {
    return;
  }
  const targetPath = input.processEnv.OSVA_SETUP_BOOTSTRAP_KEY_FILE?.trim();
  if (targetPath === undefined || targetPath.length === 0) {
    return;
  }
  await writeFileAtomic(targetPath, `${input.apiKey}\n`, {
    restrictPermissions: true,
  });
}

export async function wipeAcceptanceBootstrapKeyFile(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const targetPath = env.OSVA_SETUP_BOOTSTRAP_KEY_FILE?.trim();
  if (targetPath === undefined || targetPath.length === 0) {
    return;
  }
  await writeFile(targetPath, "", { encoding: "utf8", mode: 0o600 });
}
