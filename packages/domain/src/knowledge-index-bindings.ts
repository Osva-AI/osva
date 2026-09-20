import type { AgentManifestV1, KnowledgeIndexId } from "@osva/contracts";

export function knowledgeIndexBindingsFromManifest(
  manifest: AgentManifestV1,
): Readonly<Record<string, readonly KnowledgeIndexId[]>> {
  const knowledge = manifest.knowledge;
  if (knowledge === undefined) {
    return Object.freeze({});
  }

  const bindings: Record<string, readonly KnowledgeIndexId[]> = {};
  for (const [name, binding] of Object.entries(knowledge)) {
    bindings[name] = Object.freeze([...binding.knowledgeIndexIds]);
  }

  return Object.freeze(bindings);
}
