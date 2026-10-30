import os from "node:os";
import path from "node:path";

export function defaultInstallDir(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (localAppData !== undefined && localAppData.length > 0) {
      return path.join(localAppData, "OSVA", "install");
    }
    return path.join(os.homedir(), "AppData", "Local", "OSVA", "install");
  }
  return path.join(os.homedir(), ".osva", "install");
}

export function resolveInstallDir(
  flags: Readonly<Record<string, string | boolean>>,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const flagValue = flags["install-dir"];
  if (typeof flagValue === "boolean") {
    throw new Error("--install-dir requires a directory path.");
  }
  const raw =
    typeof flagValue === "string" && flagValue.trim().length > 0
      ? flagValue.trim()
      : env.OSVA_INSTALL_DIR?.trim();
  if (raw === undefined || raw.length === 0) {
    return path.resolve(defaultInstallDir(platform));
  }
  return path.resolve(raw);
}
