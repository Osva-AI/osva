import type { ManifestValidationView } from "./declarative-agent-manifest";
import type { AgentStudioV2StageId } from "./agent-studio-v2-stages";

export interface AgentStudioReviewBlocker {
  readonly id: string;
  readonly message: string;
  readonly actionLabel: string;
  readonly stage: AgentStudioV2StageId;
}

export function buildAgentStudioReviewBlockers(input: {
  readonly validation: ManifestValidationView;
  readonly modelProfileVersionId: string;
  readonly instructions: string;
  readonly agentName: string;
}): readonly AgentStudioReviewBlocker[] {
  const blockers: AgentStudioReviewBlocker[] = [];

  if (input.agentName.trim().length === 0) {
    blockers.push({
      id: "agent-name",
      message: "Add a name so you can recognize this agent.",
      actionLabel: "Edit name and instructions",
      stage: "describe",
    });
  }

  if (input.instructions.trim().length === 0) {
    blockers.push({
      id: "instructions",
      message: "Add instructions describing what your agent should do.",
      actionLabel: "Edit instructions",
      stage: "describe",
    });
  }

  if (input.modelProfileVersionId.trim().length === 0) {
    blockers.push({
      id: "model",
      message: "Choose an AI model version before publishing.",
      actionLabel: "Return to Equip",
      stage: "equip",
    });
  }

  for (const [fieldKey, fieldMessage] of Object.entries(
    input.validation.fieldErrors,
  )) {
    if (fieldMessage === undefined || fieldMessage.length === 0) {
      continue;
    }
    if (fieldKey === "instructions" || fieldKey === "manifestName") {
      continue;
    }
    if (fieldKey.includes("model") || fieldKey === "modelProfileVersionId") {
      if (blockers.some((entry) => entry.id === "model")) {
        continue;
      }
      blockers.push({
        id: "model-field",
        message: "Finish model selection in Equip.",
        actionLabel: "Return to Equip",
        stage: "equip",
      });
      continue;
    }
    blockers.push({
      id: fieldKey,
      message: fieldMessage,
      actionLabel: "Return to Equip",
      stage: "equip",
    });
  }

  if (!input.validation.ok) {
    for (const message of input.validation.messages) {
      if (
        /modelBinding/i.test(message) &&
        !blockers.some((b) => b.id === "model")
      ) {
        blockers.push({
          id: "model-binding",
          message: "Choose an AI model to continue.",
          actionLabel: "Return to Equip",
          stage: "equip",
        });
      }
    }
  }

  const seen = new Set<string>();
  return blockers.filter((entry) => {
    const key = `${entry.stage}:${entry.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
