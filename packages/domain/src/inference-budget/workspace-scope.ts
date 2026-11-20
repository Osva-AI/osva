import type { WorkspaceId } from "@osva-ai/contracts";

export class InferenceBudgetWorkspaceMismatchError extends Error {
  constructor() {
    super("Inference budget workspace scope mismatch");
    this.name = "InferenceBudgetWorkspaceMismatchError";
  }
}

export function assertInferenceBudgetWorkspaceScope(input: {
  readonly workspaceId: WorkspaceId;
  readonly anchorWorkspaceId?: WorkspaceId;
  readonly reservationWorkspaceId?: WorkspaceId;
  readonly ledgerWorkspaceId?: WorkspaceId;
}): void {
  if (
    input.anchorWorkspaceId !== undefined &&
    input.anchorWorkspaceId !== input.workspaceId
  ) {
    throw new InferenceBudgetWorkspaceMismatchError();
  }
  if (
    input.reservationWorkspaceId !== undefined &&
    input.reservationWorkspaceId !== input.workspaceId
  ) {
    throw new InferenceBudgetWorkspaceMismatchError();
  }
  if (
    input.ledgerWorkspaceId !== undefined &&
    input.ledgerWorkspaceId !== input.workspaceId
  ) {
    throw new InferenceBudgetWorkspaceMismatchError();
  }
}
