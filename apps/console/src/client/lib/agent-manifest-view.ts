export interface AgentRuntimeView {
  readonly type: string;
  readonly summary: string;
  readonly details: Readonly<Record<string, string>>;
}

export function readAgentRuntimeView(manifest: unknown): AgentRuntimeView {
  const runtime = isRecord(manifest) ? manifest.runtime : undefined;
  if (!isRecord(runtime) || typeof runtime.type !== "string") {
    return {
      type: "unknown",
      summary: "Runtime type is not present on this version payload.",
      details: {},
    };
  }

  const details: Record<string, string> = {};
  for (const [key, value] of Object.entries(runtime)) {
    if (key === "type") {
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      details[key] = String(value);
    }
  }

  return {
    type: runtime.type,
    summary: describeRuntimeType(runtime.type),
    details,
  };
}

export function describeRuntimeType(type: string): string {
  switch (type) {
    case "TRUSTED_TYPESCRIPT":
      return "Trusted TypeScript child-process runtime. The worker loads the entrypoint from OSVA_TRUSTED_RUNTIME_ROOT and checks integrity.";
    case "REMOTE_HTTP":
      return "Remote HTTP runtime. The worker calls the configured endpoint; capabilities re-enter OSVA gateways.";
    case "CONTAINER":
      return "Container runtime. The worker starts an ephemeral OCI container per RunAttempt. A digest-pinned image reference is not proof the image exists locally.";
    case "BUILTIN_PACKAGE":
      return "Built-in package runtime used by in-process test adapters. Production workers typically have no executor registered for this type.";
    case "DECLARATIVE":
      return "Declarative agent runtime. Instructions and budgets live on the AgentVersion; workers execute via the built-in declarative executor.";
    default:
      return "Runtime type from the immutable AgentVersion manifest.";
  }
}

export function readManifestCapabilities(manifest: unknown): {
  readonly model: boolean;
  readonly tools: readonly string[];
} {
  const capabilities = isRecord(manifest) ? manifest.capabilities : undefined;
  if (!isRecord(capabilities)) {
    return { model: false, tools: [] };
  }
  return {
    model: capabilities.model === true,
    tools: Array.isArray(capabilities.tools)
      ? capabilities.tools.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}

export function readManifestIoSchemas(manifest: unknown): {
  readonly input?: unknown;
  readonly output?: unknown;
} {
  const input =
    isRecord(manifest) && isRecord(manifest.input)
      ? manifest.input.schema
      : undefined;
  const output =
    isRecord(manifest) && isRecord(manifest.output)
      ? manifest.output.schema
      : undefined;
  return {
    input: input === undefined ? undefined : input,
    output: output === undefined ? undefined : output,
  };
}

export function readDeclarativeConfigurationSummary(manifest: unknown):
  | {
      readonly instructionsPreview: string;
      readonly modelBinding: string;
      readonly allowedTools: readonly string[];
      readonly maxModelInvocations: string;
      readonly maxToolInvocations: string;
      readonly maxOutputTokens: string;
    }
  | undefined {
  if (!isRecord(manifest) || !isRecord(manifest.runtime)) {
    return undefined;
  }
  if (manifest.runtime.type !== "DECLARATIVE") {
    return undefined;
  }
  const config = manifest.runtime.config;
  if (!isRecord(config)) {
    return undefined;
  }
  const instructions =
    typeof config.instructions === "string" ? config.instructions : "";
  return {
    instructionsPreview:
      instructions.trim().length > 0
        ? instructions.trim().slice(0, 280)
        : "(empty)",
    modelBinding:
      typeof config.modelBinding === "string" ? config.modelBinding : "primary",
    allowedTools: Array.isArray(config.allowedToolBindings)
      ? config.allowedToolBindings.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    maxModelInvocations: stringOrDash(config.maxModelInvocations),
    maxToolInvocations: stringOrDash(config.maxToolInvocations),
    maxOutputTokens: stringOrDash(config.maxOutputTokens),
  };
}

export function readManifestBindingNames(manifest: unknown): {
  readonly models: readonly string[];
  readonly tools: readonly string[];
  readonly memory: readonly string[];
  readonly knowledge: readonly string[];
} {
  return {
    models: recordKeys(isRecord(manifest) ? manifest.models : undefined),
    tools: recordKeys(isRecord(manifest) ? manifest.tools : undefined),
    memory: recordKeys(isRecord(manifest) ? manifest.memory : undefined),
    knowledge: recordKeys(isRecord(manifest) ? manifest.knowledge : undefined),
  };
}

function recordKeys(value: unknown): readonly string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function stringOrDash(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return "—";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
