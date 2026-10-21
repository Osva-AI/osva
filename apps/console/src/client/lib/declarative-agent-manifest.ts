import {
  AGENT_EXECUTION_MAX_TIMEOUT_MS,
  AGENT_EXECUTION_MIN_TIMEOUT_MS,
  DECLARATIVE_MAX_MODEL_INVOCATIONS,
  DECLARATIVE_MAX_OUTPUT_TOKENS,
  DECLARATIVE_MAX_TOOL_INVOCATIONS,
  DECLARATIVE_MIN_TOOL_INVOCATIONS,
  validateAgentManifest,
} from "@osva-ai/contracts";

import { parseWorkflowRunInputJson } from "./workflow-run-input";

export const DEFAULT_DECLARATIVE_MODEL_BINDING = "primary";

export interface DeclarativeStudioFields {
  readonly manifestKey: string;
  readonly manifestName: string;
  readonly instructions: string;
  readonly modelBinding: string;
  readonly modelProfileVersionId: string;
  readonly maxModelInvocations: string;
  readonly maxToolInvocations: string;
  readonly maxOutputTokens: string;
  readonly timeoutMs: string;
  readonly maxAttempts: string;
  readonly useCustomOutputSchema: boolean;
  readonly outputSchemaText: string;
}

export interface ManifestValidationView {
  readonly ok: boolean;
  readonly messages: readonly string[];
  readonly fieldErrors: Readonly<Record<string, string>>;
}

export function slugAgentKeyFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "new-agent";
}

export function defaultDeclarativeManifestTemplate(options?: {
  readonly key?: string;
  readonly name?: string;
}): Record<string, unknown> {
  return {
    schemaVersion: "1",
    key: options?.key ?? "new-agent",
    name: options?.name ?? "New Agent",
    runtime: {
      type: "DECLARATIVE",
      config: {
        configVersion: "1",
        instructions: "",
        modelBinding: DEFAULT_DECLARATIVE_MODEL_BINDING,
        allowedToolBindings: [],
        maxModelInvocations: 8,
        maxToolInvocations: DECLARATIVE_MIN_TOOL_INVOCATIONS,
      },
    },
    input: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          task: { type: "string", minLength: 1 },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
      },
    },
    execution: { timeoutMs: 120_000, maxAttempts: 1 },
    capabilities: { model: true, tools: [] },
  };
}

export function isDeclarativeManifest(manifest: unknown): boolean {
  return (
    isRecord(manifest) &&
    isRecord(manifest.runtime) &&
    manifest.runtime.type === "DECLARATIVE"
  );
}

export function manifestToText(manifest: Record<string, unknown>): string {
  return JSON.stringify(manifest, null, 2);
}

export function parseManifestRecord(
  text: string,
):
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly message: string } {
  const parsed = parseWorkflowRunInputJson(text);
  if (!parsed.ok) {
    return parsed;
  }
  if (!isRecord(parsed.value)) {
    return { ok: false, message: "Manifest must be a JSON object." };
  }
  return { ok: true, value: parsed.value };
}

export function readPrimaryModelProfileVersionId(
  manifest: unknown,
): string | undefined {
  if (!isRecord(manifest) || !isRecord(manifest.models)) {
    return undefined;
  }
  const rawBinding = readDeclarativeConfig(manifest)?.modelBinding;
  const bindingName =
    typeof rawBinding === "string" && rawBinding.length > 0
      ? rawBinding
      : DEFAULT_DECLARATIVE_MODEL_BINDING;
  const binding = manifest.models[bindingName];
  if (!isRecord(binding) || typeof binding.modelProfileVersionId !== "string") {
    return undefined;
  }
  return binding.modelProfileVersionId;
}

export function extractDeclarativeStudioFields(
  manifest: unknown,
): DeclarativeStudioFields {
  const record = isRecord(manifest)
    ? manifest
    : defaultDeclarativeManifestTemplate();
  const config = readDeclarativeConfig(record) ?? {
    instructions: "",
    modelBinding: DEFAULT_DECLARATIVE_MODEL_BINDING,
    maxModelInvocations: 8,
    maxToolInvocations: 0,
  };
  const execution = isRecord(record.execution) ? record.execution : {};
  const outputSchema =
    isRecord(record.output) && isRecord(record.output.schema)
      ? record.output.schema
      : { type: "object", additionalProperties: true };
  const defaultOutput = defaultDeclarativeManifestTemplate().output as {
    schema: Record<string, unknown>;
  };
  const useCustomOutputSchema =
    JSON.stringify(outputSchema) !== JSON.stringify(defaultOutput.schema);

  return {
    manifestKey: stringField(record.key, "new-agent"),
    manifestName: stringField(record.name, "New Agent"),
    instructions: stringField(config.instructions, ""),
    modelBinding: stringField(
      config.modelBinding,
      DEFAULT_DECLARATIVE_MODEL_BINDING,
    ),
    modelProfileVersionId: readPrimaryModelProfileVersionId(record) ?? "",
    maxModelInvocations: stringField(config.maxModelInvocations, "8"),
    maxToolInvocations: stringField(config.maxToolInvocations, "0"),
    maxOutputTokens:
      config.maxOutputTokens === undefined
        ? ""
        : stringField(config.maxOutputTokens, ""),
    timeoutMs: stringField(execution.timeoutMs, "120000"),
    maxAttempts: stringField(execution.maxAttempts, "1"),
    useCustomOutputSchema,
    outputSchemaText: JSON.stringify(outputSchema, null, 2),
  };
}

export function applyDeclarativeStudioPatch(
  manifest: Record<string, unknown>,
  patch: Partial<DeclarativeStudioFields>,
): Record<string, unknown> {
  const current = extractDeclarativeStudioFields(manifest);
  const next = { ...current, ...patch };
  const runtime = isRecord(manifest.runtime) ? { ...manifest.runtime } : {};
  const existingConfig = readDeclarativeConfig(manifest) ?? {};
  const maxModelInvocations = parseBoundedInt(
    next.maxModelInvocations,
    8,
    1,
    DECLARATIVE_MAX_MODEL_INVOCATIONS,
  );
  const maxToolInvocations = parseBoundedInt(
    next.maxToolInvocations,
    0,
    DECLARATIVE_MIN_TOOL_INVOCATIONS,
    DECLARATIVE_MAX_TOOL_INVOCATIONS,
  );
  const config: Record<string, unknown> = {
    ...existingConfig,
    configVersion: "1",
    instructions: next.instructions,
    modelBinding: next.modelBinding.trim() || DEFAULT_DECLARATIVE_MODEL_BINDING,
    maxModelInvocations,
    maxToolInvocations,
  };
  const maxOutputTokens = parseOptionalBoundedInt(
    next.maxOutputTokens,
    DECLARATIVE_MAX_OUTPUT_TOKENS,
  );
  if (maxOutputTokens !== undefined) {
    config.maxOutputTokens = maxOutputTokens;
  } else {
    delete config.maxOutputTokens;
  }

  const execution = isRecord(manifest.execution)
    ? { ...manifest.execution }
    : {};
  const timeoutMs = parseBoundedInt(
    next.timeoutMs,
    120_000,
    AGENT_EXECUTION_MIN_TIMEOUT_MS,
    AGENT_EXECUTION_MAX_TIMEOUT_MS,
  );
  const maxAttempts = parseBoundedInt(next.maxAttempts, 1, 1, 8);

  let outputSchema: unknown = {
    type: "object",
    additionalProperties: true,
  };
  if (next.useCustomOutputSchema) {
    const parsedOutput = parseWorkflowRunInputJson(next.outputSchemaText);
    if (parsedOutput.ok && isRecord(parsedOutput.value)) {
      outputSchema = parsedOutput.value;
    }
  }

  const updated: Record<string, unknown> = {
    ...manifest,
    schemaVersion: "1",
    key: next.manifestKey.trim() || "new-agent",
    name: next.manifestName.trim() || "New Agent",
    runtime: {
      ...runtime,
      type: "DECLARATIVE",
      config,
    },
    execution: {
      ...execution,
      timeoutMs,
      maxAttempts,
    },
    output: {
      schema: outputSchema,
    },
    capabilities: normalizeCapabilities(manifest, config),
  };

  if (next.modelProfileVersionId.trim().length > 0) {
    return applyPrimaryModelToManifest(
      updated,
      next.modelProfileVersionId.trim(),
      stringField(config.modelBinding, DEFAULT_DECLARATIVE_MODEL_BINDING),
    );
  }

  return syncDeclarativeToolBudgets(updated);
}

export function applyPrimaryModelToManifest(
  manifest: Record<string, unknown>,
  modelProfileVersionId: string,
  modelBinding = DEFAULT_DECLARATIVE_MODEL_BINDING,
): Record<string, unknown> {
  const bindingName = modelBinding.trim() || DEFAULT_DECLARATIVE_MODEL_BINDING;
  const models = isRecord(manifest.models) ? { ...manifest.models } : {};
  models[bindingName] = { modelProfileVersionId };

  const runtime = isRecord(manifest.runtime) ? { ...manifest.runtime } : {};
  const config = readDeclarativeConfig({ ...manifest, runtime }) ?? {};
  const nextConfig = {
    ...config,
    configVersion: "1",
    modelBinding: bindingName,
  };

  const capabilities = isRecord(manifest.capabilities)
    ? { ...manifest.capabilities }
    : { model: false, tools: [] as string[] };

  return syncDeclarativeToolBudgets({
    ...manifest,
    models,
    capabilities: {
      ...capabilities,
      model: true,
    },
    runtime: {
      ...runtime,
      type: "DECLARATIVE",
      config: nextConfig,
    },
  });
}

export function syncDeclarativeToolBudgets(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  if (!isDeclarativeManifest(manifest)) {
    return manifest;
  }
  const config = readDeclarativeConfig(manifest);
  if (config === undefined) {
    return manifest;
  }
  const tools = isRecord(manifest.tools) ? manifest.tools : {};
  const allowed = Object.keys(tools);
  const capabilities = isRecord(manifest.capabilities)
    ? { ...manifest.capabilities }
    : { model: true, tools: [] as string[] };

  let maxToolInvocations =
    typeof config.maxToolInvocations === "number"
      ? config.maxToolInvocations
      : 0;
  if (allowed.length === 0) {
    maxToolInvocations = DECLARATIVE_MIN_TOOL_INVOCATIONS;
  } else if (maxToolInvocations < allowed.length) {
    maxToolInvocations = Math.min(
      allowed.length,
      DECLARATIVE_MAX_TOOL_INVOCATIONS,
    );
  }

  const runtime = isRecord(manifest.runtime) ? { ...manifest.runtime } : {};
  return {
    ...manifest,
    capabilities: {
      ...capabilities,
      tools: allowed,
    },
    runtime: {
      ...runtime,
      config: {
        ...config,
        allowedToolBindings: allowed,
        maxToolInvocations,
      },
    },
  };
}

export function describeDeclarativeManifestValidation(
  manifest: unknown,
): ManifestValidationView {
  const result = validateAgentManifest(manifest);
  if (result.ok) {
    return { ok: true, messages: [], fieldErrors: {} };
  }

  const fieldErrors: Record<string, string> = {};
  for (const message of result.messages) {
    if (message.includes("instructions")) {
      fieldErrors.instructions ??= message;
    } else if (
      message.includes("modelBinding") ||
      message.includes("manifest.models") ||
      message.includes("capabilities.model")
    ) {
      fieldErrors.model ??= message;
    } else if (
      message.includes("allowedToolBindings") ||
      message.includes("capabilities.tools")
    ) {
      fieldErrors.tools ??= message;
    } else if (
      message.includes("maxModelInvocations") ||
      message.includes("maxToolInvocations")
    ) {
      fieldErrors.budgets ??= message;
    } else if (message.includes("output") || message.includes("schema")) {
      fieldErrors.outputSchema ??= message;
    } else if (
      message.includes("timeoutMs") ||
      message.includes("maxAttempts")
    ) {
      fieldErrors.execution ??= message;
    }
  }

  let trimmedInstructions = "";
  if (isRecord(manifest)) {
    const config = readDeclarativeConfig(manifest);
    if (config !== undefined && typeof config.instructions === "string") {
      trimmedInstructions = config.instructions.trim();
    }
  }
  if (trimmedInstructions.length === 0) {
    fieldErrors.instructions =
      "Agent instructions are required. Describe what this agent should do.";
  }
  if (
    isDeclarativeManifest(manifest) &&
    readPrimaryModelProfileVersionId(manifest) === undefined
  ) {
    fieldErrors.model ??=
      "Select a published model version before saving this agent.";
  }

  return {
    ok: false,
    messages: result.messages,
    fieldErrors,
  };
}

export function cloneManifestForNewVersion(
  source: unknown,
  options?: { readonly key?: string; readonly name?: string },
): Record<string, unknown> {
  if (!isRecord(source)) {
    return defaultDeclarativeManifestTemplate(options);
  }
  const cloned = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  if (options?.key !== undefined) {
    cloned.key = options.key;
  }
  if (options?.name !== undefined) {
    cloned.name = options.name;
  }
  return cloned;
}

function normalizeCapabilities(
  manifest: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const tools = isRecord(manifest.tools) ? Object.keys(manifest.tools) : [];
  const allowed = Array.isArray(config.allowedToolBindings)
    ? config.allowedToolBindings.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : tools;
  const normalizedTools =
    allowed.length > 0 ? allowed : tools.length > 0 ? tools : [];
  return {
    model: true,
    tools: normalizedTools,
  };
}

function readDeclarativeConfig(
  manifest: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!isRecord(manifest.runtime) || manifest.runtime.type !== "DECLARATIVE") {
    return undefined;
  }
  const config = manifest.runtime.config;
  return isRecord(config) ? config : undefined;
}

function parseBoundedInt(
  raw: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function parseOptionalBoundedInt(raw: string, max: number): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.min(max, parsed);
}

function stringField(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
