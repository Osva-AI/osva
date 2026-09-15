import type { AgentManifestV1, ModelProfileVersionId } from "@osva/contracts";

export function modelProfileVersionBindingsFromManifest(
  manifest: AgentManifestV1,
): Readonly<Record<string, ModelProfileVersionId>> {
  const models = manifest.models;
  if (models === undefined) {
    return Object.freeze({});
  }

  const bindings: Record<string, ModelProfileVersionId> = {};
  for (const [name, binding] of Object.entries(models)) {
    bindings[name] = binding.modelProfileVersionId;
  }

  return Object.freeze(bindings);
}
