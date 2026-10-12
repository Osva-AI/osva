import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ConsoleConfigurationError,
  defaultClientDistDir,
  loadConsoleConfig,
} from "../src/server/config.js";

describe("console config", () => {
  it("defaultClientDistDir resolves client output adjacent to the server module", () => {
    const serverModuleDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/server",
    );
    expect(defaultClientDistDir()).toBe(
      path.resolve(serverModuleDir, "../client"),
    );
  });

  it("rejects public Console binds unless OSVA_CONSOLE_ALLOW_PUBLIC_BIND is set", () => {
    expect(() =>
      loadConsoleConfig({
        OSVA_CONSOLE_API_KEY: "osva_ak_test",
        OSVA_CONSOLE_HOST: "0.0.0.0",
      }),
    ).toThrow(ConsoleConfigurationError);

    expect(
      loadConsoleConfig({
        OSVA_CONSOLE_API_KEY: "osva_ak_test",
        OSVA_CONSOLE_HOST: "127.0.0.1",
      }).host,
    ).toBe("127.0.0.1");

    expect(
      loadConsoleConfig({
        OSVA_CONSOLE_API_KEY: "osva_ak_test",
        OSVA_CONSOLE_HOST: "0.0.0.0",
        OSVA_CONSOLE_ALLOW_PUBLIC_BIND: "true",
      }).host,
    ).toBe("0.0.0.0");
  });
});
