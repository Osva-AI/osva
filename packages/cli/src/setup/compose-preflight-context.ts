import path from "node:path";

import type { ComposeExecContext } from "./compose-exec.js";
import { installEnvValuesFromEnvMap, readInstallEnvFile } from "./env-file.js";
import type { SetupOptions } from "./read-options.js";
import { REMOTE_HTTP_DEV_PROFILE_ENV } from "./remote-http-dev.js";

export async function readPreflightComposeContext(
  options: SetupOptions,
): Promise<ComposeExecContext | undefined> {
  const envPath = path.join(options.installDir, ".env");
  const envMap = await readInstallEnvFile(envPath);
  if (envMap === undefined) {
    return undefined;
  }
  try {
    const values = installEnvValuesFromEnvMap(envMap);
    return {
      installDir: options.installDir,
      envFilePath: envPath,
      projectName: values.COMPOSE_PROJECT_NAME,
      remoteHttpDevProfile: values[REMOTE_HTTP_DEV_PROFILE_ENV] === "true",
    };
  } catch {
    return undefined;
  }
}
