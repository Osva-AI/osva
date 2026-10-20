import type {
  AgentManifestCapabilities,
  AgentManifestV1,
  DeclarativeAgentRuntime,
} from "./agent-manifest.js";
import { MODEL_BINDING_NAME_PATTERN } from "./model-gateway.js";
import { TOOL_BINDING_NAME_PATTERN } from "./tool-gateway.js";

export const DECLARATIVE_AGENT_CONFIG_VERSION = "1" as const;

export type DeclarativeAgentConfigVersion =
  typeof DECLARATIVE_AGENT_CONFIG_VERSION;

/** Maximum characters stored for natural-language instructions (after trim). */
export const DECLARATIVE_INSTRUCTIONS_MAX_LENGTH = 32_768;

/** Inclusive bounds for declarative execution budgets (M13.1A contract only). */
export const DECLARATIVE_MIN_MODEL_INVOCATIONS = 1;
export const DECLARATIVE_MAX_MODEL_INVOCATIONS = 32;

export const DECLARATIVE_MIN_TOOL_INVOCATIONS = 0;
export const DECLARATIVE_MAX_TOOL_INVOCATIONS = 64;

export const DECLARATIVE_MIN_OUTPUT_TOKENS = 1;
export const DECLARATIVE_MAX_OUTPUT_TOKENS = 16_384;

export const DECLARATIVE_MAX_ALLOWED_TOOL_BINDINGS = 32;

const MODEL_BINDING_NAME = new RegExp(MODEL_BINDING_NAME_PATTERN);
const TOOL_BINDING_NAME = new RegExp(TOOL_BINDING_NAME_PATTERN);

export function isDeclarativeAgentRuntime(
  runtime: AgentManifestV1["runtime"],
): runtime is DeclarativeAgentRuntime {
  return runtime.type === "DECLARATIVE";
}

/**
 * Cross-field invariants for `runtime.type === "DECLARATIVE"`.
 * Structural/runtime.config checks belong in Zod; binding existence at append.
 */
export function collectDeclarativeManifestIssues(manifest: {
  readonly runtime: AgentManifestV1["runtime"];
  readonly capabilities: AgentManifestCapabilities;
  readonly models?: AgentManifestV1["models"];
  readonly tools?: AgentManifestV1["tools"];
}): readonly string[] {
  if (!isDeclarativeAgentRuntime(manifest.runtime)) {
    return [];
  }

  const issues: string[] = [];
  const config = manifest.runtime.config;
  const models = manifest.models ?? {};
  const tools = manifest.tools ?? {};

  if (!manifest.capabilities.model) {
    issues.push("Declarative agents require capabilities.model to be true.");
  }

  if (!MODEL_BINDING_NAME.test(config.modelBinding)) {
    issues.push(
      "runtime.config.modelBinding must be a valid logical model binding name.",
    );
  } else if (models[config.modelBinding] === undefined) {
    issues.push(
      `runtime.config.modelBinding '${config.modelBinding}' is not declared in manifest.models.`,
    );
  }

  const allowed = config.allowedToolBindings;
  const seen = new Set<string>();
  for (const name of allowed) {
    if (!TOOL_BINDING_NAME.test(name)) {
      issues.push(
        `runtime.config.allowedToolBindings entry '${name}' is not a valid tool binding name.`,
      );
      continue;
    }
    if (seen.has(name)) {
      issues.push(
        `runtime.config.allowedToolBindings must not contain duplicate '${name}'.`,
      );
    }
    seen.add(name);

    if (tools[name] === undefined) {
      issues.push(
        `runtime.config.allowedToolBindings references unknown tool binding '${name}'.`,
      );
    }

    if (!manifest.capabilities.tools.includes(name)) {
      issues.push(
        `Tool binding '${name}' is not authorized in capabilities.tools.`,
      );
    }
  }

  if (
    allowed.length === 0 &&
    config.maxToolInvocations !== DECLARATIVE_MIN_TOOL_INVOCATIONS
  ) {
    issues.push(
      "runtime.config.maxToolInvocations must be 0 when allowedToolBindings is empty.",
    );
  }

  return issues;
}
