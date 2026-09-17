export interface OpenTelemetryConfig {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly otlpEndpoint: string | undefined;
  readonly otlpHeaders: Record<string, string>;
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw.trim().length === 0) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const segment of raw.split(",")) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key.length > 0) {
      headers[key] = value;
    }
  }

  return headers;
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function loadOpenTelemetryConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpenTelemetryConfig {
  if (isTruthy(env.OTEL_SDK_DISABLED)) {
    return {
      enabled: false,
      serviceName: env.OTEL_SERVICE_NAME?.trim() || "osva",
      otlpEndpoint: undefined,
      otlpHeaders: {},
    };
  }

  const otlpEndpoint =
    env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim() ||
    undefined;

  return {
    enabled: otlpEndpoint !== undefined,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || "osva",
    otlpEndpoint,
    otlpHeaders: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
  };
}
