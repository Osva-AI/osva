import { describe, expect, it } from "vitest";

import { createWorkerApplication } from "../src/worker.js";
import { loadWorkerConfig } from "../src/config.js";

describe("createWorkerApplication", () => {
  it("enters the running state after a successful readiness check", async () => {
    let readinessCalls = 0;
    const worker = createWorkerApplication({
      readinessCheck: async () => {
        readinessCalls += 1;
      },
    });

    expect(worker.status()).toBe("created");
    await worker.start();
    expect(worker.status()).toBe("running");
    expect(readinessCalls).toBe(1);
  });

  it("does not enter the running state when readiness fails", async () => {
    const worker = createWorkerApplication({
      readinessCheck: async () => {
        throw new Error("PostgreSQL is unavailable.");
      },
    });

    await expect(worker.start()).rejects.toThrow("PostgreSQL is unavailable.");
    expect(worker.status()).toBe("created");
  });

  it("closes cleanly and treats stop as idempotent", async () => {
    let closeCalls = 0;
    const worker = createWorkerApplication({
      readinessCheck: async () => undefined,
      onClose: async () => {
        closeCalls += 1;
      },
    });

    await worker.start();
    await worker.stop();
    await worker.stop();

    expect(worker.status()).toBe("stopped");
    expect(closeCalls).toBe(1);
  });

  it("exposes only start, status, and stop on the process shell", () => {
    const worker = createWorkerApplication({
      readinessCheck: async () => undefined,
    });

    expect(worker).not.toHaveProperty("execute");
    expect(Object.keys(worker).sort()).toEqual(["start", "status", "stop"]);
  });

  it("runs onStart after readiness succeeds", async () => {
    let started = false;
    const worker = createWorkerApplication({
      readinessCheck: async () => undefined,
      onStart: async () => {
        started = true;
      },
    });

    await worker.start();
    expect(started).toBe(true);
    expect(worker.status()).toBe("running");
  });
});

describe("loadWorkerConfig", () => {
  it("requires OSVA_DATABASE_URL without echoing its value", () => {
    expect(() => loadWorkerConfig({})).toThrow(
      "OSVA_DATABASE_URL is required.",
    );
  });

  it("requires OSVA_VALKEY_URL", () => {
    expect(() =>
      loadWorkerConfig({
        OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
      }),
    ).toThrow("OSVA_VALKEY_URL is required.");
  });

  it("keeps runtime capability configuration optional for trusted-only workers", () => {
    expect(
      loadWorkerConfig({
        OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
        OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
      }),
    ).toMatchObject({
      runtimeCapabilityHost: "127.0.0.1",
      runtimeCapabilityPort: 0,
      runtimeCapabilitySecret: undefined,
      runtimeCapabilityBaseUrl: undefined,
      remoteHttpAllowPrivateNetworks: false,
    });
  });

  it("enables REMOTE_HTTP private networks only from explicit operator env", () => {
    const env = {
      OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
      OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
    };
    expect(
      loadWorkerConfig({
        ...env,
        OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true",
      }).remoteHttpAllowPrivateNetworks,
    ).toBe(true);
    expect(
      loadWorkerConfig({
        ...env,
        OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "false",
      }).remoteHttpAllowPrivateNetworks,
    ).toBe(false);
    expect(() =>
      loadWorkerConfig({
        ...env,
        OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "workspace-yes",
      }),
    ).toThrow("OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS must be true or false.");
  });
});
