import { applyKnowledgeBindingsToManifestText } from "./agent-knowledge-bindings";
import { applyMemoryBindingsToManifestText } from "./agent-memory-bindings";
import { applyToolBindingsToManifestText } from "./agent-tool-bindings";
import { extractKnowledgeBindingRows } from "./agent-knowledge-bindings";
import { extractMemoryBindingRows } from "./agent-memory-bindings";
import { parseManifestRecord } from "./declarative-agent-manifest";

export type AgentStudioOptionalCapability = "tools" | "knowledge" | "memory";

export function readOptionalCapabilitiesFromManifest(
  manifestText: string,
): Set<AgentStudioOptionalCapability> {
  const enabled = new Set<AgentStudioOptionalCapability>();
  const parsed = parseManifestRecord(manifestText);
  if (!parsed.ok) {
    return enabled;
  }
  const manifest = parsed.value;
  if (manifestHasToolBindings(manifest)) {
    enabled.add("tools");
  }
  if (extractKnowledgeBindingRows(manifest).length > 0) {
    enabled.add("knowledge");
  }
  if (extractMemoryBindingRows(manifest).length > 0) {
    enabled.add("memory");
  }
  return enabled;
}

function manifestHasToolBindings(manifest: Record<string, unknown>): boolean {
  const config = readDeclarativeConfig(manifest);
  const allowed = config?.allowedToolBindings;
  if (Array.isArray(allowed) && allowed.length > 0) {
    return true;
  }
  if (isRecord(manifest.tools) && Object.keys(manifest.tools).length > 0) {
    return true;
  }
  return false;
}

function readDeclarativeConfig(
  manifest: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const runtime = manifest.runtime;
  if (!isRecord(runtime) || !isRecord(runtime.config)) {
    return undefined;
  }
  return runtime.config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function clearOptionalCapabilityFromManifest(
  manifestText: string,
  capability: AgentStudioOptionalCapability,
): string {
  switch (capability) {
    case "tools":
      return applyToolBindingsToManifestText(manifestText, []);
    case "knowledge":
      return applyKnowledgeBindingsToManifestText(manifestText, []);
    case "memory":
      return applyMemoryBindingsToManifestText(manifestText, []);
  }
}
