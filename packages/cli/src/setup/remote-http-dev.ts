import path from "node:path";

export const REMOTE_HTTP_DEV_COMPOSE_FILE = "compose.remote-http-dev.yml";

export const REMOTE_HTTP_DEV_PROFILE_ENV = "OSVA_REMOTE_HTTP_DEV_PROFILE";

export const DEFAULT_RUNTIME_CAPABILITY_PORT = 8787;

export function remoteHttpDevComposePath(installDir: string): string {
  return path.join(installDir, REMOTE_HTTP_DEV_COMPOSE_FILE);
}

export function isRemoteHttpDevProfileEnabled(
  envMap: ReadonlyMap<string, string>,
): boolean {
  return isTruthyProfileFlag(envMap.get(REMOTE_HTTP_DEV_PROFILE_ENV)?.trim());
}

function isTruthyProfileFlag(raw: string | undefined): boolean {
  return raw === "true" || raw === "1" || raw === "yes";
}

export function readRemoteHttpDevSetupFlag(
  flags: Readonly<Record<string, string | boolean>>,
  processEnv: NodeJS.ProcessEnv,
): boolean {
  if (flags["remote-http-dev"] === true) {
    return true;
  }
  const setupEnv = processEnv.OSVA_SETUP_REMOTE_HTTP_DEV?.trim();
  return setupEnv === "1" || setupEnv === "true" || setupEnv === "yes";
}

export function runtimeCapabilityBaseUrlForPort(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}
