import type { AgentManifestV1, ToolVersionId } from "@osva/contracts";

export function toolVersionBindingsFromManifest(
  manifest: AgentManifestV1,
): Readonly<Record<string, ToolVersionId>> {
  const tools = manifest.tools;
  if (tools === undefined) {
    return Object.freeze({});
  }

  const bindings: Record<string, ToolVersionId> = {};
  for (const [name, binding] of Object.entries(tools)) {
    bindings[name] = binding.toolVersionId;
  }

  return Object.freeze(bindings);
}
