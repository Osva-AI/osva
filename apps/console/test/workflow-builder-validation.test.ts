import type { AgentVersionId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  createEmptyWorkflowBuilderDraft,
  validateDraftForPublish,
} from "../src/client/lib/workflow-builder-draft";
import {
  addWorkflowNode,
  connectWorkflowNodes,
  setAgentNodeVersion,
  updateWorkflowNode,
} from "../src/client/lib/workflow-builder-graph";
import {
  analyzeWorkflowBuilderDraft,
  errorNodeKeys,
} from "../src/client/lib/workflow-builder-validation";

const workspaceId = "ws-test";
const av1 = "av-1" as AgentVersionId;

function withRegistry<T extends { registry: { key: string; name: string } }>(
  draft: T,
): T {
  return { ...draft, registry: { key: "wf", name: "WF" } };
}

describe("workflow builder validation", () => {
  it("accepts a valid linear AGENT workflow", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addWorkflowNode(draft, "AGENT");
    draft = addWorkflowNode(draft, "AGENT");
    const [first, second] = draft.definition.nodes.map((node) => node.key);
    draft = connectWorkflowNodes(draft, first!, second!);
    draft = setAgentNodeVersion(draft, first!, av1);
    draft = setAgentNodeVersion(draft, second!, av1);
    draft = withRegistry(draft);

    const snapshot = structuredClone(draft);
    const report = analyzeWorkflowBuilderDraft(draft);
    const published = validateDraftForPublish(draft);

    expect(report.canPublish).toBe(true);
    expect(published.ok).toBe(true);
    expect(draft).toEqual(snapshot);
  });

  it("flags missing agent versions as node errors", () => {
    let draft = withRegistry(createEmptyWorkflowBuilderDraft(workspaceId));
    draft = addWorkflowNode(draft, "AGENT");
    const report = analyzeWorkflowBuilderDraft(draft);
    expect(report.canPublish).toBe(false);
    expect(
      report.issues.some((item) => item.code === "agent_version_required"),
    ).toBe(true);
    expect([...errorNodeKeys(report)]).toEqual([
      draft.definition.nodes[0]!.key,
    ]);
  });

  it("flags invalid BRANCH configuration", () => {
    let draft = withRegistry(createEmptyWorkflowBuilderDraft(workspaceId));
    draft = addWorkflowNode(draft, "BRANCH");
    const report = analyzeWorkflowBuilderDraft(draft);
    const codes = report.issues.map((item) => item.code);
    expect(codes).toContain("branch_cases_required");
    expect(codes).toContain("branch_default_required");
    expect(codes).toContain("branch_out_degree");
  });

  it("flags invalid PARALLEL/JOIN topology", () => {
    let draft = withRegistry(createEmptyWorkflowBuilderDraft(workspaceId));
    draft = addWorkflowNode(draft, "PARALLEL");
    draft = addWorkflowNode(draft, "JOIN");
    const report = analyzeWorkflowBuilderDraft(draft);
    expect(
      report.issues.some((item) => item.code === "parallel_out_degree"),
    ).toBe(true);
    expect(report.issues.some((item) => item.code === "join_in_degree")).toBe(
      true,
    );
  });

  it("flags invalid WAIT configuration", () => {
    let draft = withRegistry(createEmptyWorkflowBuilderDraft(workspaceId));
    draft = addWorkflowNode(draft, "WAIT");
    const waitKey = draft.definition.nodes[0]!.key;
    draft = updateWorkflowNode(draft, waitKey, {
      key: waitKey,
      type: "WAIT",
      wait: { kind: "DURATION", durationMs: 0 },
    });
    const report = analyzeWorkflowBuilderDraft(draft);
    expect(
      report.issues.some((item) => item.code === "wait_duration_invalid"),
    ).toBe(true);
  });

  it("clears node errors after they are corrected", () => {
    let draft = withRegistry(createEmptyWorkflowBuilderDraft(workspaceId));
    draft = addWorkflowNode(draft, "AGENT");
    const key = draft.definition.nodes[0]!.key;
    expect(analyzeWorkflowBuilderDraft(draft).canPublish).toBe(false);
    draft = setAgentNodeVersion(draft, key, av1);
    expect(analyzeWorkflowBuilderDraft(draft).canPublish).toBe(true);
    expect(validateDraftForPublish(draft).ok).toBe(true);
  });
});
