/**
 * Pure guards for M20.5 refinement concurrency (testable without React).
 */
export function shouldApplyRefinementResponse(input: {
  readonly requestGen: number;
  readonly currentRequestGen: number;
  readonly snapshotWorkspaceId: string;
  readonly currentWorkspaceId: string | undefined;
  readonly snapshotBaseProposalDigest: string;
  readonly currentBaseProposalDigest: string | undefined;
  readonly responseBaseProposalDigest?: string;
}): boolean {
  if (input.requestGen !== input.currentRequestGen) {
    return false;
  }
  if (input.currentWorkspaceId !== input.snapshotWorkspaceId) {
    return false;
  }
  if (input.currentBaseProposalDigest !== input.snapshotBaseProposalDigest) {
    return false;
  }
  if (
    input.responseBaseProposalDigest !== undefined &&
    input.responseBaseProposalDigest !== input.snapshotBaseProposalDigest
  ) {
    return false;
  }
  return true;
}

export function canAcceptRefinementCandidate(input: {
  readonly candidateBaseProposalDigest: string | undefined;
  readonly currentBaseProposalDigest: string | undefined;
}): boolean {
  if (
    input.candidateBaseProposalDigest === undefined ||
    input.currentBaseProposalDigest === undefined
  ) {
    return false;
  }
  return input.candidateBaseProposalDigest === input.currentBaseProposalDigest;
}
