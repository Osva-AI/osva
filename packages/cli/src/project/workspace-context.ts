import type { OsvaClient } from "@osva-ai/sdk";

import { ProjectConfigurationError } from "./errors.js";

export async function resolveAuthenticatedWorkspace(input: {
  readonly client: OsvaClient;
  readonly configuredWorkspaceId?: string;
}): Promise<string> {
  let context;
  try {
    context = await input.client.auth.getContext();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not resolve authenticated workspace.";
    throw new ProjectConfigurationError(message);
  }

  const workspaceId = context.workspaceId.trim();
  if (workspaceId.length === 0) {
    throw new ProjectConfigurationError("Authenticated workspace id is empty.");
  }

  const configured = input.configuredWorkspaceId?.trim();
  if (
    configured !== undefined &&
    configured.length > 0 &&
    configured !== workspaceId
  ) {
    throw new ProjectConfigurationError(
      `OSVA_WORKSPACE_ID (${configured}) does not match the workspace for OSVA_API_KEY (${workspaceId}).`,
    );
  }

  return workspaceId;
}
