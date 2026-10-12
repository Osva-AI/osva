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

  it("defaults to IPv4 loopback and allows IPv6 loopback and localhost", () => {
    expect(
      loadConsoleConfig({
        OSVA_CONSOLE_API_KEY: "osva_ak_test",
      }).host,
    ).toBe("127.0.0.1");

    expect(
      loadConsoleConfig({
        OSVA_CONSOLE_API_KEY: "osva_ak_test",
        OSVA_CONSOLE_HOST: "::1",
      }).host,
    ).toBe("::1");

    expect(
      loadConsoleConfig({
        OSVA_CONSOLE_API_KEY: "osva_ak_test",
        OSVA_CONSOLE_HOST: "localhost",
      }).host,
    ).toBe("localhost");
  });

  it("rejects wildcard, LAN, and public Console binds even when OSVA_CONSOLE_ALLOW_PUBLIC_BIND is set", () => {
    for (const host of ["0.0.0.0", "::", "*", "192.168.1.10", "10.0.0.5"]) {
      expect(() =>
        loadConsoleConfig({
          OSVA_CONSOLE_API_KEY: "osva_ak_test",
          OSVA_CONSOLE_HOST: host,
        }),
      ).toThrow(ConsoleConfigurationError);

      expect(() =>
        loadConsoleConfig({
          OSVA_CONSOLE_API_KEY: "osva_ak_test",
          OSVA_CONSOLE_HOST: host,
          OSVA_CONSOLE_ALLOW_PUBLIC_BIND: "true",
        }),
      ).toThrow(/deprecated|loopback/i);
    }
  });

  it("does not treat lookalike hostnames as loopback", () => {
    expect(() =>
      loadConsoleConfig({
        OSVA_CONSOLE_API_KEY: "osva_ak_test",
        OSVA_CONSOLE_HOST: "localhost.example.com",
      }),
    ).toThrow(ConsoleConfigurationError);
  });

  it("parses explicit allowed origins and rejects wildcards", () => {
    expect(
      loadConsoleConfig({
        OSVA_CONSOLE_API_KEY: "osva_ak_test",
        OSVA_CONSOLE_ALLOWED_ORIGINS: "https://console.example.com",
      }).allowedOrigins,
    ).toEqual(["https://console.example.com"]);

    expect(() =>
      loadConsoleConfig({
        OSVA_CONSOLE_API_KEY: "osva_ak_test",
        OSVA_CONSOLE_ALLOWED_ORIGINS: "*",
      }),
    ).toThrow(ConsoleConfigurationError);
  });
});
