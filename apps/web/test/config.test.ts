import { describe, expect, it } from "vitest";

import { loadWebConfig } from "../src/config.js";
import { postgresReadinessCheck } from "../src/readiness.js";

describe("loadWebConfig", () => {
  it("requires OSVA_DATABASE_URL", () => {
    expect(() => loadWebConfig({})).toThrow("OSVA_DATABASE_URL is required.");
  });

  it("uses local host and port defaults", () => {
    const config = loadWebConfig({
      OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
    });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.databaseUrl).toBe("postgres://osva@127.0.0.1:5432/osva");
  });

  it("reads host and port overrides", () => {
    const config = loadWebConfig({
      OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
      OSVA_WEB_HOST: "0.0.0.0",
      OSVA_WEB_PORT: "8080",
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
  });

  it("rejects an invalid port without including the database URL", () => {
    expect(() =>
      loadWebConfig({
        OSVA_DATABASE_URL: "postgres://secret@127.0.0.1:5432/osva",
        OSVA_WEB_PORT: "not-a-port",
      }),
    ).toThrow("OSVA_WEB_PORT must be an integer between 0 and 65535.");

    try {
      loadWebConfig({
        OSVA_DATABASE_URL: "postgres://secret@127.0.0.1:5432/osva",
        OSVA_WEB_PORT: "not-a-port",
      });
    } catch (error) {
      expect(String(error)).not.toContain("secret");
      expect(String(error)).not.toContain("postgres://");
    }
  });
});

describe("postgresReadinessCheck", () => {
  it("returns true when ping succeeds", async () => {
    const check = postgresReadinessCheck({
      ping: async () => undefined,
    });

    await expect(check()).resolves.toBe(true);
  });

  it("returns false when ping fails without exposing the driver error", async () => {
    const check = postgresReadinessCheck({
      ping: async () => {
        throw new Error("ECONNREFUSED postgres://secret@127.0.0.1/osva");
      },
    });

    await expect(check()).resolves.toBe(false);
  });
});
