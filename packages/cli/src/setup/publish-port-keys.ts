import type { InstallEnvKey } from "./env-file.js";
import type { SetupOptions } from "./read-options.js";

export type PublishServiceKey = "web" | "mcp" | "console" | "runtime";

export const PUBLISH_SERVICE_ENV_KEYS: Readonly<
  Record<PublishServiceKey, InstallEnvKey>
> = {
  web: "OSVA_PUBLISH_WEB_PORT",
  mcp: "OSVA_PUBLISH_MCP_PORT",
  console: "OSVA_PUBLISH_CONSOLE_PORT",
  runtime: "OSVA_PUBLISH_RUNTIME_CAPABILITY_PORT",
};

export const ASSIGNMENT_FIELD_BY_SERVICE: Readonly<
  Record<
    PublishServiceKey,
    keyof Pick<
      SetupOptions,
      "webPort" | "mcpPort" | "consolePort" | "runtimeCapabilityPort"
    >
  >
> = {
  web: "webPort",
  mcp: "mcpPort",
  console: "consolePort",
  runtime: "runtimeCapabilityPort",
};
