import type { ModelProviderConnectionVersionResource } from "../hooks/use-models";

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic",
  GOOGLE_GEMINI: "Google Gemini",
};

export function formatModelProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function describeModelsWriteRoleRequirement(): string {
  return "Creating or changing models requires Developer, Admin, or Owner.";
}

export function describeModelsExecuteRoleRequirement(): string {
  return "Connectivity tests require Operator, Developer, Admin, or Owner.";
}

export function formatConnectionCredentialStatus(
  version: Pick<ModelProviderConnectionVersionResource, "credential">,
): string {
  return version.credential?.configured === true ? "Configured" : "Not set";
}

export function formatConnectionEndpointSummary(
  version: Pick<ModelProviderConnectionVersionResource, "endpoint">,
): string {
  const baseUrl = version.endpoint?.baseUrl?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) {
    return "Provider default";
  }
  return baseUrl;
}

export function summarizeConnectionVersionOption(input: {
  readonly connectionName: string;
  readonly version: ModelProviderConnectionVersionResource;
}): string {
  const endpoint = formatConnectionEndpointSummary(input.version);
  const credential = formatConnectionCredentialStatus(input.version);
  return `${input.connectionName} · v${String(input.version.version)} · ${endpoint} · ${credential}`;
}
