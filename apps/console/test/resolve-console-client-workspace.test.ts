import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";

import type { ConsoleConfig } from "../src/server/config.js";
import { resolveConsoleClient } from "../src/server/resolve-console-client.js";

describe("resolveConsoleClient workspace binding", () => {
  it("uses human session mode with per-request workspace selection", () => {
    const config: ConsoleConfig = {
      osvaBaseUrl: "http://127.0.0.1:3000",
      osvaApiKey: "unused",
      legacyApiKeyMode: false,
      host: "127.0.0.1",
      port: 4174,
      clientDistDir: "/tmp/unused",
      allowedOrigins: [],
    };

    const workspaceA = resolveConsoleClient(
      {
        headers: { "x-osva-workspace-id": "workspace-a" },
      } as unknown as IncomingMessage,
      { config, legacyClient: undefined, testClient: undefined },
    );
    const workspaceB = resolveConsoleClient(
      {
        headers: { "x-osva-workspace-id": "workspace-b" },
      } as unknown as IncomingMessage,
      { config, legacyClient: undefined, testClient: undefined },
    );

    expect(workspaceA.mode).toBe("human_session");
    expect(workspaceB.mode).toBe("human_session");
    expect(workspaceA.client).not.toBe(workspaceB.client);
  });
});
