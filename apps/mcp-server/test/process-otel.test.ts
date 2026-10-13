import { describe, expect, it } from "vitest";
import { createOpenTelemetryLifecycle } from "@osva/adapters-opentelemetry";
import { NO_OP_INSTRUMENTATION } from "@osva/observability";

import { createMcpServerProcess } from "../src/process.js";

const BASE_ENV = {
  OSVA_API_BASE_URL: "http://127.0.0.1:1",
  OSVA_MCP_HOST: "127.0.0.1",
  OSVA_MCP_PORT: "0",
};

describe("MCP OpenTelemetry lifecycle", () => {
  it("starts without OTLP and shuts instrumentation down", async () => {
    let shutdowns = 0;
    const process = createMcpServerProcess(BASE_ENV, {
      telemetry: {
        instrumentation: NO_OP_INSTRUMENTATION,
        config: createOpenTelemetryLifecycle(BASE_ENV, {
          defaultServiceName: "osva-mcp",
        }).config,
        shutdown: async () => {
          shutdowns += 1;
        },
      },
    });
    await process.start();
    expect(process.port).toBeGreaterThan(0);
    const health = await fetch(
      `http://127.0.0.1:${String(process.port)}/health`,
    );
    expect(health.status).toBe(200);
    await process.stop();
    expect(shutdowns).toBe(1);
  });

  it("honors an explicit service name override in no-op mode", () => {
    const lifecycle = createOpenTelemetryLifecycle(
      { ...BASE_ENV, OTEL_SERVICE_NAME: "custom-mcp" },
      { defaultServiceName: "osva-mcp" },
    );
    expect(lifecycle.config.enabled).toBe(false);
    expect(lifecycle.config.serviceName).toBe("custom-mcp");
  });

  it("does not block process construction when export is enabled against an unused endpoint", async () => {
    const process = createMcpServerProcess({
      ...BASE_ENV,
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
    });
    await process.start();
    expect(process.port).toBeGreaterThan(0);
    await process.stop();
  });
});
