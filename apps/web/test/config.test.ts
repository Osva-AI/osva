import { describe, expect, it } from "vitest";

import { loadWebConfig } from "../src/config.js";
import { TEST_AUTH_SECRET, withTestAuthEnv } from "./support/auth-env.js";
import {
  postgresAndValkeyReadinessCheck,
  postgresReadinessCheck,
} from "../src/readiness.js";

describe("loadWebConfig", () => {
  it("requires OSVA_DATABASE_URL", () => {
    expect(() => loadWebConfig({})).toThrow("OSVA_DATABASE_URL is required.");
  });

  it("requires OSVA_VALKEY_URL", () => {
    expect(() =>
      loadWebConfig(
        withTestAuthEnv({
          OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
        }),
      ),
    ).toThrow("OSVA_VALKEY_URL is required.");
  });

  it("uses local host and port defaults", () => {
    const config = loadWebConfig(
      withTestAuthEnv({
        OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
        OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
      }),
    );

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.databaseUrl).toBe("postgres://osva@127.0.0.1:5432/osva");
    expect(config.valkeyUrl).toBe("redis://127.0.0.1:6379");
    expect(config.unauthenticatedRateLimitPerMinute).toBe(60);
    expect(config.authenticatedRateLimitPerMinute).toBe(600);
    expect(config.trustedProxies).toEqual([]);
    expect(config.authSecret).toBe(TEST_AUTH_SECRET);
    expect(config.authBaseUrl).toBe("http://127.0.0.1:3000");
  });

  it("reads rate-limit and trusted-proxy overrides", () => {
    const config = loadWebConfig(
      withTestAuthEnv({
        OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
        OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
        OSVA_RATE_LIMIT_UNAUTH_PER_MINUTE: "5",
        OSVA_RATE_LIMIT_AUTH_PER_MINUTE: "50",
        OSVA_TRUSTED_PROXIES: "10.0.0.0/8, 192.168.1.1",
      }),
    );

    expect(config.unauthenticatedRateLimitPerMinute).toBe(5);
    expect(config.authenticatedRateLimitPerMinute).toBe(50);
    expect(config.trustedProxies).toEqual(["10.0.0.0/8", "192.168.1.1"]);
  });

  it("reads host and port overrides", () => {
    const config = loadWebConfig(
      withTestAuthEnv({
        OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
        OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
        OSVA_WEB_HOST: "0.0.0.0",
        OSVA_WEB_PORT: "8080",
      }),
    );

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
  });

  it("rejects an invalid port without including the database URL", () => {
    expect(() =>
      loadWebConfig(
        withTestAuthEnv({
          OSVA_DATABASE_URL: "postgres://secret@127.0.0.1:5432/osva",
          OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
          OSVA_WEB_PORT: "not-a-port",
        }),
      ),
    ).toThrow("OSVA_WEB_PORT must be an integer between 0 and 65535.");

    try {
      loadWebConfig(
        withTestAuthEnv({
          OSVA_DATABASE_URL: "postgres://secret@127.0.0.1:5432/osva",
          OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
          OSVA_WEB_PORT: "not-a-port",
        }),
      );
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

    await expect(check()).resolves.toEqual({
      ready: true,
      failedDependencies: [],
    });
  });

  it("returns false when ping fails without exposing the driver error", async () => {
    const check = postgresReadinessCheck({
      ping: async () => {
        throw new Error("ECONNREFUSED postgres://secret@127.0.0.1/osva");
      },
    });

    await expect(check()).resolves.toEqual({
      ready: false,
      failedDependencies: ["postgres"],
    });
  });
});

describe("postgresAndValkeyReadinessCheck", () => {
  it("returns true when PostgreSQL and Valkey pings succeed", async () => {
    const check = postgresAndValkeyReadinessCheck(
      { ping: async () => undefined },
      { ping: async () => undefined },
    );

    await expect(check()).resolves.toEqual({
      ready: true,
      failedDependencies: [],
    });
  });

  it("returns false when Valkey ping fails", async () => {
    const check = postgresAndValkeyReadinessCheck(
      { ping: async () => undefined },
      {
        ping: async () => {
          throw new Error("Valkey is unavailable.");
        },
      },
    );

    await expect(check()).resolves.toEqual({
      ready: false,
      failedDependencies: ["valkey"],
    });
  });

  it("reports both dependencies when PostgreSQL and Valkey fail", async () => {
    const check = postgresAndValkeyReadinessCheck(
      {
        ping: async () => {
          throw new Error("ECONNREFUSED postgres://secret@127.0.0.1/osva");
        },
      },
      {
        ping: async () => {
          throw new Error("redis://secret@127.0.0.1");
        },
      },
    );

    await expect(check()).resolves.toEqual({
      ready: false,
      failedDependencies: ["postgres", "valkey"],
    });
  });
});
