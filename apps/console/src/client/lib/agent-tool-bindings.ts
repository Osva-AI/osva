import { TOOL_BINDING_NAME_PATTERN } from "@osva-ai/contracts";

import { syncDeclarativeToolBudgets } from "./declarative-agent-manifest";
import { parseWorkflowRunInputJson } from "./workflow-run-input";

export type ToolBindingCatalogRow = {
  readonly tool: { readonly id: string };
  readonly versions: readonly { readonly id: string }[];
};

function lookupToolVersionInBindingCatalog(
  catalog: readonly ToolBindingCatalogRow[] | undefined,
  toolVersionId: string,
): boolean {
  if (catalog === undefined) {
    return false;
  }
  return catalog.some((row) =>
    row.versions.some((version) => version.id === toolVersionId),
  );
}

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

export function suggestBindingNameForRemoteTool(
  remoteToolName: string,
): string {
  const sanitized = remoteToolName
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[^A-Za-z]+/, "");
  if (sanitized.length === 0) {
    return "tool";
  }
  const normalized =
    sanitized.charAt(0).match(/[A-Za-z]/) !== null
      ? sanitized
      : `t_${sanitized}`;
  return normalized.slice(0, 64);
}

export type ToolBindingValidationIssueKind =
  | "missing_binding_name"
  | "invalid_binding_name"
  | "duplicate_binding_name"
  | "missing_tool_version"
  | "stale_tool_version"
  | "duplicate_tool_version";

export interface ToolBindingValidationIssue {
  readonly kind: ToolBindingValidationIssueKind;
  readonly message: string;
  readonly bindingName?: string;
  readonly rowIndex?: number;
}

export function collectToolBindingValidationIssues(
  rows: readonly AgentToolBindingRow[],
  catalog: readonly ToolBindingCatalogRow[] | undefined,
): readonly ToolBindingValidationIssue[] {
  const issues: ToolBindingValidationIssue[] = [];
  const names = new Map<string, number>();
  const versionIds = new Map<string, number>();

  rows.forEach((row, rowIndex) => {
    const hasContent =
      row.bindingName.trim().length > 0 ||
      row.toolVersionId.trim().length > 0 ||
      row.toolId.length > 0;
    if (!hasContent) {
      return;
    }
    const bindingName = row.bindingName.trim();
    if (bindingName.length === 0) {
      issues.push({
        kind: "missing_binding_name",
        message: "Each binding needs a logical binding name.",
        rowIndex,
      });
    } else {
      const nameError = describeToolBindingNameError(bindingName);
      if (nameError !== undefined) {
        issues.push({
          kind: "invalid_binding_name",
          message: nameError,
          bindingName,
          rowIndex,
        });
      }
      const prior = names.get(bindingName);
      if (prior !== undefined) {
        issues.push({
          kind: "duplicate_binding_name",
          message: `Duplicate binding name “${bindingName}”.`,
          bindingName,
          rowIndex,
        });
      } else {
        names.set(bindingName, rowIndex);
      }
    }

    if (row.toolVersionId.trim().length === 0) {
      issues.push({
        kind: "missing_tool_version",
        message:
          bindingName.length > 0
            ? `Binding “${bindingName}” is missing a ToolVersion.`
            : "Select an immutable ToolVersion for each binding.",
        bindingName: bindingName.length > 0 ? bindingName : undefined,
        rowIndex,
      });
    } else if (
      !lookupToolVersionInBindingCatalog(catalog, row.toolVersionId.trim())
    ) {
      issues.push({
        kind: "stale_tool_version",
        message: `ToolVersion ${row.toolVersionId.trim()} is not visible in this workspace.`,
        bindingName: bindingName.length > 0 ? bindingName : undefined,
        rowIndex,
      });
    }

    const versionKey = row.toolVersionId.trim();
    if (versionKey.length > 0) {
      const priorVersion = versionIds.get(versionKey);
      if (priorVersion !== undefined) {
        issues.push({
          kind: "duplicate_tool_version",
          message:
            "The same ToolVersion is bound more than once — use one binding per ToolVersion unless intentionally aliasing.",
          rowIndex,
        });
      } else {
        versionIds.set(versionKey, rowIndex);
      }
    }
  });

  return issues;
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
  const synced = syncDeclarativeToolBudgets(record);
  return JSON.stringify(synced, null, 2);
}
