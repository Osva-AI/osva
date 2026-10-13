export const OSVA_OTEL_SERVICE_NAMES = {
  WEB: "osva-web",
  WORKER: "osva-worker",
  SCHEDULER: "osva-scheduler",
  WORKFLOW_ORCHESTRATOR: "osva-workflow-orchestrator",
  MCP: "osva-mcp",
  KNOWLEDGE_WORKER: "osva-knowledge-worker",
} as const;

export interface OpenTelemetryConfig {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly otlpEndpoint: string | undefined;
  readonly otlpHeaders: Record<string, string>;
  readonly tracesSampler: string | undefined;
  readonly tracesSamplerArg: string | undefined;
}

export interface LoadOpenTelemetryConfigOptions {
  readonly defaultServiceName?: string;
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
  options: LoadOpenTelemetryConfigOptions = {},
): OpenTelemetryConfig {
  const defaultServiceName = options.defaultServiceName?.trim() || "osva";
  const serviceName = env.OTEL_SERVICE_NAME?.trim() || defaultServiceName;
  const tracesSampler = env.OTEL_TRACES_SAMPLER?.trim() || undefined;
  const tracesSamplerArg = env.OTEL_TRACES_SAMPLER_ARG?.trim() || undefined;

  if (isTruthy(env.OTEL_SDK_DISABLED)) {
    return {
      enabled: false,
      serviceName,
      otlpEndpoint: undefined,
      otlpHeaders: {},
      tracesSampler,
      tracesSamplerArg,
    };
  }

  const otlpEndpoint =
    env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim() ||
    undefined;

  return {
    enabled: otlpEndpoint !== undefined,
    serviceName,
    otlpEndpoint,
    otlpHeaders: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    tracesSampler,
    tracesSamplerArg,
  };
}
