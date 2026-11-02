export type AgentStudioSectionId =
  | "identity"
  | "model"
  | "tools"
  | "knowledge"
  | "memory"
  | "execution"
  | "advanced";

export interface AgentStudioSectionDefinition {
  readonly id: AgentStudioSectionId;
  readonly title: string;
  readonly description: string;
  readonly fieldKeys: readonly string[];
}

export const AGENT_STUDIO_SECTIONS: readonly AgentStudioSectionDefinition[] = [
  {
    id: "identity",
    title: "Identity & instructions",
    description: "Name, key, and trusted agent instructions.",
    fieldKeys: ["instructions", "manifestKey", "manifestName"],
  },
  {
    id: "model",
    title: "Model",
    description: "Immutable ModelProfileVersion binding.",
    fieldKeys: ["model"],
  },
  {
    id: "tools",
    title: "Tools",
    description: "Optional ToolVersion bindings and grants.",
    fieldKeys: ["tools"],
  },
  {
    id: "knowledge",
    title: "Knowledge",
    description: "Optional READY knowledge indexes.",
    fieldKeys: [],
  },
  {
    id: "memory",
    title: "Memory",
    description: "Optional namespace access.",
    fieldKeys: [],
  },
  {
    id: "execution",
    title: "Execution settings",
    description: "Timeouts, attempt limits, and call budgets.",
    fieldKeys: ["budgets", "execution", "outputSchema"],
  },
  {
    id: "advanced",
    title: "Advanced JSON",
    description: "Full manifest document (same draft as guided fields).",
    fieldKeys: [],
  },
];

export function sectionHasFieldError(
  section: AgentStudioSectionDefinition,
  fieldErrors: Readonly<Record<string, string>>,
): boolean {
  return section.fieldKeys.some((key) => fieldErrors[key] !== undefined);
}

export function firstSectionWithError(
  fieldErrors: Readonly<Record<string, string>>,
): AgentStudioSectionId | undefined {
  for (const section of AGENT_STUDIO_SECTIONS) {
    if (sectionHasFieldError(section, fieldErrors)) {
      return section.id;
    }
  }
  return undefined;
}
