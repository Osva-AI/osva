import { describe, expect, it } from "vitest";

import { loadOpenTelemetryConfig } from "../src/config.js";
import { createOpenTelemetryLifecycle } from "../src/node-sdk.js";
import { createTraceSampler } from "../src/sampler.js";

describe("loadOpenTelemetryConfig", () => {
  it("disables export when no OTLP endpoint is configured", () => {
    const config = loadOpenTelemetryConfig({});
    expect(config.enabled).toBe(false);
  });

  it("uses process default service names and preserves explicit overrides", () => {
    expect(
      loadOpenTelemetryConfig({}, { defaultServiceName: "osva-web" })
        .serviceName,
    ).toBe("osva-web");
    expect(
      loadOpenTelemetryConfig({}, { defaultServiceName: "osva-mcp" })
        .serviceName,
    ).toBe("osva-mcp");
    expect(
      loadOpenTelemetryConfig(
        {},
        { defaultServiceName: "osva-knowledge-worker" },
      ).serviceName,
    ).toBe("osva-knowledge-worker");
    expect(
      loadOpenTelemetryConfig(
        { OTEL_SERVICE_NAME: "custom-service" },
        { defaultServiceName: "osva-web" },
      ).serviceName,
    ).toBe("custom-service");
  });

  it("enables vendor-neutral OTLP export from standard env vars", () => {
    const config = loadOpenTelemetryConfig({
      OTEL_SERVICE_NAME: "osva-worker",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer test-token",
      OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
      OTEL_TRACES_SAMPLER_ARG: "0.1",
    });

    expect(config.enabled).toBe(true);
    expect(config.serviceName).toBe("osva-worker");
    expect(config.otlpEndpoint).toBe("http://127.0.0.1:4318");
    expect(config.otlpHeaders.Authorization).toBe("Bearer test-token");
    expect(config.tracesSampler).toBe("parentbased_traceidratio");
    expect(config.tracesSamplerArg).toBe("0.1");
  });

  it("honors OTEL_SDK_DISABLED", () => {
    const config = loadOpenTelemetryConfig({
      OTEL_SDK_DISABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
    });

    expect(config.enabled).toBe(false);
  });

  it("stays no-op without an endpoint even when a sampler is configured", async () => {
    const lifecycle = createOpenTelemetryLifecycle(
      { OTEL_TRACES_SAMPLER: "always_off" },
      { defaultServiceName: "osva-scheduler" },
    );
    expect(lifecycle.config.enabled).toBe(false);
    expect(lifecycle.config.serviceName).toBe("osva-scheduler");
    await lifecycle.shutdown();
  });
});

describe("createTraceSampler", () => {
  it("supports standard sampler names and ignores unknown values", () => {
    expect(createTraceSampler("always_on", undefined)?.constructor.name).toBe(
      "AlwaysOnSampler",
    );
    expect(createTraceSampler("always_off", undefined)?.constructor.name).toBe(
      "AlwaysOffSampler",
    );
    expect(createTraceSampler("traceidratio", "0.25")).toBeDefined();
    expect(
      createTraceSampler("parentbased_always_on", undefined),
    ).toBeDefined();
    expect(createTraceSampler("not-a-sampler", "1")).toBeUndefined();
    expect(createTraceSampler(undefined, undefined)).toBeUndefined();
  });
});
