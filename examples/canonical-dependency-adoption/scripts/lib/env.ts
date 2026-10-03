import type { ModelProvider } from "@osva-ai/contracts";
import { MODEL_PROVIDERS } from "@osva-ai/contracts";

export interface SetupEnv {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly trustedRuntimeRoot: string;
  readonly modelProvider: ModelProvider;
  readonly model: string;
  readonly setupTimeoutMs: number;
  readonly knowledgePollIntervalMs: number;
  readonly knowledgePollTimeoutMs: number;
}

export class SetupConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupConfigurationError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new SetupConfigurationError(
      `Missing ${name}. Set this before running canonical setup.`,
    );
  }
  return value;
}

function parseModelProvider(raw: string): ModelProvider {
  const normalized = raw.trim().toUpperCase();
  if (!(MODEL_PROVIDERS as readonly string[]).includes(normalized)) {
    throw new SetupConfigurationError(
      `Invalid OSVA_CANONICAL_MODEL_PROVIDER '${raw}'. Expected one of: ${MODEL_PROVIDERS.join(", ")}.`,
    );
  }
  return normalized as ModelProvider;
}

export function loadSetupEnv(): SetupEnv {
  const trustedRuntimeRoot = requireEnv("OSVA_TRUSTED_RUNTIME_ROOT");
  const modelProviderRaw =
    process.env.OSVA_CANONICAL_MODEL_PROVIDER?.trim() ?? "OPENAI";
  const model =
    process.env.OSVA_CANONICAL_MODEL?.trim() ??
    (modelProviderRaw.toUpperCase() === "OPENAI" ? "gpt-4.1-mini" : "");

  if (model.length === 0) {
    throw new SetupConfigurationError(
      "Missing OSVA_CANONICAL_MODEL. Set the provider model id for the canonical primary binding.",
    );
  }

  return {
    baseUrl: requireEnv("OSVA_BASE_URL"),
    apiKey: requireEnv("OSVA_API_KEY"),
    workspaceId: requireEnv("OSVA_WORKSPACE_ID"),
    trustedRuntimeRoot,
    modelProvider: parseModelProvider(modelProviderRaw),
    model,
    setupTimeoutMs: 120_000,
    knowledgePollIntervalMs: 2_000,
    knowledgePollTimeoutMs: 600_000,
  };
}

export const stdioMcpServiceNote = [
  "STDIO MCP connectors require OSVA_MCP_STDIO_CONNECTORS_ENABLED=true on:",
  "  - apps/web (connector discover/import)",
  "  - apps/worker (tool execution)",
].join("\n");
