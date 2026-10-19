import { TOOL_BINDING_NAME_PATTERN } from "@osva-ai/contracts";

import { parseWorkflowRunInputJson } from "./workflow-run-input";

export interface AgentToolBindingRow {
  readonly bindingName: string;
  readonly toolId: string;
  readonly toolVersionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractToolBindingRows(
  manifest: unknown,
): readonly AgentToolBindingRow[] {
  if (!isRecord(manifest)) {
    return [];
  }
  const toolsMap = isRecord(manifest.tools) ? manifest.tools : {};
  return Object.entries(toolsMap).flatMap(([bindingName, binding]) => {
    if (!isRecord(binding) || typeof binding.toolVersionId !== "string") {
      return [];
    }
    return [
      {
        bindingName,
        toolId: "",
        toolVersionId: binding.toolVersionId,
      },
    ];
  });
}

export function describeToolBindingNameError(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Binding name is required.";
  }
  if (!TOOL_BINDING_NAME_PATTERN.test(trimmed)) {
    return "Binding names must start with a letter and use only letters, digits, '_' or '-'.";
  }
  return undefined;
}

export function applyToolBindingsToManifestText(
  manifestText: string,
  rows: readonly AgentToolBindingRow[],
): string {
  const parsed = parseWorkflowRunInputJson(manifestText);
  if (!parsed.ok) {
    return manifestText;
  }
  const record = { ...(parsed.value as Record<string, unknown>) };
  const tools: Record<string, { toolVersionId: string }> = {};
  const capabilityNames: string[] = [];
  for (const row of rows) {
    const nameError = describeToolBindingNameError(row.bindingName);
    if (nameError !== undefined || row.toolVersionId.trim().length === 0) {
      continue;
    }
    const bindingName = row.bindingName.trim();
    tools[bindingName] = { toolVersionId: row.toolVersionId.trim() };
    capabilityNames.push(bindingName);
  }
  const capabilities = isRecord(record.capabilities)
    ? { ...record.capabilities }
    : { model: false, tools: [] as string[] };
  record.capabilities = {
    ...capabilities,
    tools: capabilityNames,
  };
  if (Object.keys(tools).length === 0) {
    delete record.tools;
  } else {
    record.tools = tools;
  }
  return JSON.stringify(record, null, 2);
}
