import { describe, expect, it } from "vitest";
import type { SecretResolver, StdioTransportConfig } from "@osva/contracts";

import { resolveStdioProcessEnvironment } from "../src/stdio-environment.js";

describe("resolveStdioProcessEnvironment", () => {
  it("merges plaintext and resolved secret environment", async () => {
    const config: StdioTransportConfig = {
      command: "node",
      args: [],
      environment: { LOG_LEVEL: "info" },
      secretEnvironment: {
        GITHUB_TOKEN: { key: "GITHUB_CONNECTOR_TOKEN" },
      },
    };

    const resolver: SecretResolver = {
      async resolve(reference) {
        if (reference.key === "GITHUB_CONNECTOR_TOKEN") {
          return "secret-value";
        }
        return "";
      },
    };

    const env = await resolveStdioProcessEnvironment(config, resolver);
    expect(env).toEqual({
      LOG_LEVEL: "info",
      GITHUB_TOKEN: "secret-value",
    });
  });

  it("fails when secret cannot be resolved", async () => {
    const config: StdioTransportConfig = {
      command: "node",
      args: [],
      secretEnvironment: { TOKEN: { key: "MISSING" } },
    };

    await expect(
      resolveStdioProcessEnvironment(config, {
        async resolve() {
          return "";
        },
      }),
    ).rejects.toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });
  });
});
