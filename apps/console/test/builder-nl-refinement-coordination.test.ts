import { describe, expect, it } from "vitest";

import {
  canAcceptRefinementCandidate,
  shouldApplyRefinementResponse,
} from "../src/client/lib/builder-nl-refinement-coordination.js";

describe("builder NL refinement coordination", () => {
  const snap = {
    requestGen: 3,
    snapshotWorkspaceId: "ws-a",
    snapshotBaseProposalDigest: "sha256:base",
  };

  it("rejects stale request generation", () => {
    expect(
      shouldApplyRefinementResponse({
        ...snap,
        currentRequestGen: 4,
        currentWorkspaceId: "ws-a",
        currentBaseProposalDigest: "sha256:base",
      }),
    ).toBe(false);
  });

  it("rejects workspace switch", () => {
    expect(
      shouldApplyRefinementResponse({
        ...snap,
        currentRequestGen: 3,
        currentWorkspaceId: "ws-b",
        currentBaseProposalDigest: "sha256:base",
      }),
    ).toBe(false);
  });

  it("rejects manual edit during in-flight refinement", () => {
    expect(
      shouldApplyRefinementResponse({
        ...snap,
        currentRequestGen: 3,
        currentWorkspaceId: "ws-a",
        currentBaseProposalDigest: "sha256:edited",
      }),
    ).toBe(false);
  });

  it("rejects response base digest mismatch", () => {
    expect(
      shouldApplyRefinementResponse({
        ...snap,
        currentRequestGen: 3,
        currentWorkspaceId: "ws-a",
        currentBaseProposalDigest: "sha256:base",
        responseBaseProposalDigest: "sha256:other",
      }),
    ).toBe(false);
  });

  it("accepts matching snapshot", () => {
    expect(
      shouldApplyRefinementResponse({
        ...snap,
        currentRequestGen: 3,
        currentWorkspaceId: "ws-a",
        currentBaseProposalDigest: "sha256:base",
        responseBaseProposalDigest: "sha256:base",
      }),
    ).toBe(true);
  });

  it("blocks accept when draft digest drifted after candidate review", () => {
    expect(
      canAcceptRefinementCandidate({
        candidateBaseProposalDigest: "sha256:base",
        currentBaseProposalDigest: "sha256:newer",
      }),
    ).toBe(false);
    expect(
      canAcceptRefinementCandidate({
        candidateBaseProposalDigest: "sha256:base",
        currentBaseProposalDigest: "sha256:base",
      }),
    ).toBe(true);
  });
});
