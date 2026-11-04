import type { ManifestValidationView } from "./declarative-agent-manifest";

export type AgentStudioV2StageId = "describe" | "equip" | "review" | "test";

export const AGENT_STUDIO_V2_STAGES: readonly {
  readonly id: AgentStudioV2StageId;
  readonly title: string;
  readonly headline: string;
}[] = [
  {
    id: "describe",
    title: "Describe",
    headline: "What should your agent do?",
  },
  {
    id: "equip",
    title: "Equip",
    headline: "What will your agent need?",
  },
  {
    id: "review",
    title: "Review",
    headline: "Review your agent",
  },
  {
    id: "test",
    title: "Test",
    headline: "Test your agent",
  },
] as const;

export function describeStageIndex(stage: AgentStudioV2StageId): number {
  return AGENT_STUDIO_V2_STAGES.findIndex((entry) => entry.id === stage);
}

export function canAdvanceFromDescribe(input: {
  readonly agentName: string;
  readonly instructions: string;
  readonly manifestParseOk: boolean;
}): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (input.agentName.trim().length === 0) {
    return {
      ok: false,
      message: "Add a name so you can recognize this agent.",
    };
  }
  if (!input.manifestParseOk) {
    return {
      ok: false,
      message: "Fix manifest syntax in Advanced JSON before continuing.",
    };
  }
  if (input.instructions.trim().length === 0) {
    return {
      ok: false,
      message: "Add instructions describing what your agent should do.",
    };
  }
  return { ok: true };
}

export function canAdvanceFromEquip(input: {
  readonly manifestParseOk: boolean;
  readonly modelProfileVersionId: string;
}): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (!input.manifestParseOk) {
    return {
      ok: false,
      message: "Fix manifest syntax in Advanced JSON before continuing.",
    };
  }
  if (input.modelProfileVersionId.trim().length === 0) {
    return {
      ok: false,
      message: "Choose an AI model version before continuing to review.",
    };
  }
  return { ok: true };
}

export function reviewPublishReady(input: {
  readonly canWrite: boolean;
  readonly validation: ManifestValidationView;
  readonly manifestParseOk: boolean;
}): boolean {
  return (
    input.canWrite &&
    input.manifestParseOk &&
    input.validation.ok &&
    !input.validation.fieldErrors.instructions &&
    !input.validation.fieldErrors.model &&
    !input.validation.fieldErrors.modelProfileVersionId
  );
}
