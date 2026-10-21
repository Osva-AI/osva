import { KNOWLEDGE_BINDING_NAME_PATTERN } from "@osva-ai/contracts";

import { parseWorkflowRunInputJson } from "./workflow-run-input";

export interface AgentKnowledgeBindingRow {
  readonly bindingName: string;
  readonly knowledgeIndexIds: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractKnowledgeBindingRows(
  manifest: unknown,
): readonly AgentKnowledgeBindingRow[] {
  if (!isRecord(manifest) || !isRecord(manifest.knowledge)) {
    return [];
  }

  return Object.entries(manifest.knowledge).flatMap(
    ([bindingName, binding]) => {
      if (!isRecord(binding) || !Array.isArray(binding.knowledgeIndexIds)) {
        return [];
      }
      const ids = binding.knowledgeIndexIds.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      );
      if (ids.length === 0) {
        return [];
      }
      return [{ bindingName, knowledgeIndexIds: ids }];
    },
  );
}

export function describeKnowledgeBindingNameError(
  name: string,
): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Binding name is required.";
  }
  if (!KNOWLEDGE_BINDING_NAME_PATTERN.test(trimmed)) {
    return "Binding names must start with a letter and use only letters, digits, '_' or '-'.";
  }
  return undefined;
}

export function applyKnowledgeBindingsToManifestText(
  manifestText: string,
  rows: readonly AgentKnowledgeBindingRow[],
): string {
  const parsed = parseWorkflowRunInputJson(manifestText);
  if (!parsed.ok || !isRecord(parsed.value)) {
    return manifestText;
  }

  const record = { ...parsed.value };
  const knowledge: Record<string, { knowledgeIndexIds: string[] }> = {};

  for (const row of rows) {
    const nameError = describeKnowledgeBindingNameError(row.bindingName);
    const ids = row.knowledgeIndexIds
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (nameError !== undefined || ids.length === 0) {
      continue;
    }
    knowledge[row.bindingName.trim()] = { knowledgeIndexIds: [...ids] };
  }

  if (Object.keys(knowledge).length === 0) {
    delete record.knowledge;
  } else {
    record.knowledge = knowledge;
  }

  return JSON.stringify(record, null, 2);
}
