import { describe, expect, it } from "vitest";

import {
  readProcessProbeBind,
  startProcessProbeServer,
} from "../src/process-probe-server.js";

describe("process probe server", () => {
  it("defaults to a disabled bind when OSVA_HEALTH_PORT is unset", () => {
    expect(readProcessProbeBind({})).toEqual({
      host: "127.0.0.1",
      port: 0,
    });
  });

  it("does not report ready when the dependency check fails", async () => {
    const server = await startProcessProbeServer({
      host: "127.0.0.1",
      port: 0,
      readinessCheck: async () => {
        throw new Error("valkey unavailable");
      },
    });
    expect(server).toBeUndefined();

    const listening = await startProcessProbeServer({
      host: "127.0.0.1",
      port: 0, // still disabled
      readinessCheck: async () => undefined,
    });
    expect(listening).toBeUndefined();

    const live = await startProcessProbeServer({
      host: "127.0.0.1",
      port: 18_081,
      readinessCheck: async () => {
        throw new Error("postgres unavailable");
      },
    });
    if (live === undefined) {
      throw new Error("expected probe server");
    }

    try {
      const health = await fetch(
        `http://127.0.0.1:${String(live.port)}/health`,
      );
      expect(health.status).toBe(200);
      const ready = await fetch(`http://127.0.0.1:${String(live.port)}/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: "unavailable" });
    } finally {
      await live.close();
    }
  });
});
