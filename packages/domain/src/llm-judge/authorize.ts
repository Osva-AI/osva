import type {
  JudgeBackedEvaluatorConfigBase,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { ModelProfileRepository } from "../ports/model-profile-repository.js";

export async function assertLlmJudgeModelAuthorized(
  modelProfiles: ModelProfileRepository,
  workspaceId: WorkspaceId,
  config: JudgeBackedEvaluatorConfigBase,
): Promise<ModelProfileVersionId> {
  const version = await modelProfiles.findModelProfileVersionById(
    config.modelProfileVersionId,
  );
  if (version === null) {
    throw new Error(
      `ModelProfileVersion '${config.modelProfileVersionId}' was not found.`,
    );
  }

  const profile = await modelProfiles.findModelProfileByWorkspaceAndId(
    workspaceId,
    version.modelProfileId,
  );
  if (profile === null) {
    throw new Error(
      `ModelProfileVersion '${config.modelProfileVersionId}' is not available in workspace '${workspaceId}'.`,
    );
  }

  return version.id;
}
