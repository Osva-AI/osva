import {
  MEMORY_ACCESS_MODES,
  MEMORY_BINDING_NAME_PATTERN,
  type MemoryAccessMode,
} from "@osva-ai/contracts";

import { parseWorkflowRunInputJson } from "./workflow-run-input";

export interface AgentMemoryBindingRow {
  readonly bindingName: string;
  readonly namespaceId: string;
  readonly access: MemoryAccessMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractMemoryBindingRows(
  manifest: unknown,
): readonly AgentMemoryBindingRow[] {
  if (!isRecord(manifest) || !isRecord(manifest.memory)) {
    return [];
  }

  return Object.entries(manifest.memory).flatMap(([bindingName, binding]) => {
    if (!isRecord(binding) || typeof binding.namespaceId !== "string") {
      return [];
    }
    const access =
      typeof binding.access === "string" &&
      (MEMORY_ACCESS_MODES as readonly string[]).includes(binding.access)
        ? (binding.access as MemoryAccessMode)
        : "READ_ONLY";
    return [
      {
        bindingName,
        namespaceId: binding.namespaceId,
        access,
      },
    ];
  });
}

export function describeMemoryBindingNameError(
  name: string,
): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Binding name is required.";
  }
  if (!MEMORY_BINDING_NAME_PATTERN.test(trimmed)) {
    return "Binding names must start with a letter and use only letters, digits, '_' or '-'.";
  }
  return undefined;
}

export function applyMemoryBindingsToManifestText(
  manifestText: string,
  rows: readonly AgentMemoryBindingRow[],
): string {
  const parsed = parseWorkflowRunInputJson(manifestText);
  if (!parsed.ok || !isRecord(parsed.value)) {
    return manifestText;
  }

  const record = { ...parsed.value };
  const memory: Record<
    string,
    { namespaceId: string; access: MemoryAccessMode }
  > = {};

  for (const row of rows) {
    const nameError = describeMemoryBindingNameError(row.bindingName);
    const namespaceId = row.namespaceId.trim();
    if (nameError !== undefined || namespaceId.length === 0) {
      continue;
    }
    memory[row.bindingName.trim()] = {
      namespaceId,
      access: row.access,
    };
  }

  if (Object.keys(memory).length === 0) {
    delete record.memory;
  } else {
    record.memory = memory;
  }

  return JSON.stringify(record, null, 2);
}
