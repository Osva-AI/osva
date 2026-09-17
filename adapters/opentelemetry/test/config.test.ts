import { describe, expect, it } from "vitest";

import { loadOpenTelemetryConfig } from "../src/config.js";

describe("loadOpenTelemetryConfig", () => {
  it("disables export when no OTLP endpoint is configured", () => {
    const config = loadOpenTelemetryConfig({});
    expect(config.enabled).toBe(false);
  });

  it("enables vendor-neutral OTLP export from standard env vars", () => {
    const config = loadOpenTelemetryConfig({
      OTEL_SERVICE_NAME: "osva-worker",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer test-token",
    });

    expect(config.enabled).toBe(true);
    expect(config.serviceName).toBe("osva-worker");
    expect(config.otlpEndpoint).toBe("http://127.0.0.1:4318");
    expect(config.otlpHeaders.Authorization).toBe("Bearer test-token");
  });

  it("honors OTEL_SDK_DISABLED", () => {
    const config = loadOpenTelemetryConfig({
      OTEL_SDK_DISABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
    });

    expect(config.enabled).toBe(false);
  });
});
