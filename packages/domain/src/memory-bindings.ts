import type { AgentManifestV1, MemoryNamespaceBinding } from "@osva/contracts";

export function memoryNamespaceBindingsFromManifest(
  manifest: AgentManifestV1,
): Readonly<Record<string, MemoryNamespaceBinding>> {
  const memory = manifest.memory;
  if (memory === undefined) {
    return Object.freeze({});
  }

  const bindings: Record<string, MemoryNamespaceBinding> = {};
  for (const [name, binding] of Object.entries(memory)) {
    bindings[name] = Object.freeze({
      namespaceId: binding.namespaceId,
      access: binding.access,
    });
  }

  return Object.freeze(bindings);
}
