import type { IncomingMessage } from "node:http";

import type { ConsoleConfig } from "./config.js";
import { createHumanSessionOsvaClient } from "./human-session-osva-client.js";
import type { ConsoleOsvaClient } from "./osva-client.js";
import { readBrowserWorkspaceId } from "./workspace-header.js";

export interface ConsoleClientResolution {
  readonly client: ConsoleOsvaClient | undefined;
  readonly mode:
    "test_override" | "legacy_api_key" | "human_session" | "unconfigured";
}

export function resolveConsoleClient(
  request: IncomingMessage,
  options: {
    readonly config: ConsoleConfig | undefined;
    readonly legacyClient: ConsoleOsvaClient | undefined;
    readonly testClient: ConsoleOsvaClient | undefined;
  },
): ConsoleClientResolution {
  if (options.testClient !== undefined) {
    return { client: options.testClient, mode: "test_override" };
  }

  if (options.config === undefined) {
    return { client: undefined, mode: "unconfigured" };
  }

  if (options.config.legacyApiKeyMode) {
    return { client: options.legacyClient, mode: "legacy_api_key" };
  }

  const workspaceId = readBrowserWorkspaceId(request);
  return {
    client: createHumanSessionOsvaClient(options.config, {
      incoming: request,
      workspaceId,
    }),
    mode: "human_session",
  };
}
