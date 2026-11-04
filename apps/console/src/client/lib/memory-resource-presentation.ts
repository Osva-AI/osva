import type { MemoryAccessMode } from "@osva-ai/contracts";

import type { MemoryNamespaceResource } from "../hooks/use-knowledge-memory";
import { safeJsonStringify } from "./formatting";

export const MEMORY_RECORD_PREVIEW_MAX_CHARS = 120;

export function describeMemoryWriteRoleRequirement(): string {
  return "Creating memory namespaces requires Developer, Admin, or Owner.";
}

export function formatMemoryAccessModeLabel(mode: MemoryAccessMode): string {
  if (mode === "READ_ONLY") {
    return "Read only";
  }
  return "Read & write";
}

export function describeMemoryAccessMode(mode: MemoryAccessMode): string {
  if (mode === "READ_ONLY") {
    return "Agent may read records through the memory gateway at run time.";
  }
  return "Agent may read and write through the memory gateway when runtime authorization allows.";
}

export function formatMemoryNamespaceOption(
  namespace: MemoryNamespaceResource,
): string {
  const description =
    namespace.description !== undefined && namespace.description.length > 0
      ? ` · ${namespace.description}`
      : "";
  return `${namespace.name} (${namespace.key})${description}`;
}

export function summarizeMemoryRecordPreview(value: unknown): {
  readonly preview: string;
  readonly isTruncated: boolean;
  readonly fullLength: number;
} {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return {
      preview: "(value not JSON-serializable)",
      isTruncated: false,
      fullLength: 0,
    };
  }

  if (serialized.length <= MEMORY_RECORD_PREVIEW_MAX_CHARS) {
    return {
      preview: serialized,
      isTruncated: false,
      fullLength: serialized.length,
    };
  }

  return {
    preview: `${serialized.slice(0, MEMORY_RECORD_PREVIEW_MAX_CHARS)}…`,
    isTruncated: true,
    fullLength: serialized.length,
  };
}

export function memoryRecordValueKind(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `array (${String(value.length)} items)`;
  }
  switch (typeof value) {
    case "object":
      return `object (${String(Object.keys(value as object).length)} keys)`;
    case "string":
      return `string (${String((value as string).length)} chars)`;
    default:
      return typeof value;
  }
}

export function formatMemoryRecordFullJson(value: unknown): string {
  return safeJsonStringify(value);
}
