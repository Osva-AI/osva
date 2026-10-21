import { describe, expect, it } from "vitest";

import { createEmptyWorkflowBuilderDraft } from "../src/client/lib/workflow-builder-linear";
import {
  applyWorkflowBuilderTemplate,
  WORKFLOW_BUILDER_TEMPLATES,
} from "../src/client/lib/workflow-builder-templates";
import { analyzeWorkflowBuilderDraft } from "../src/client/lib/workflow-builder-validation";

describe("workflow builder templates", () => {
  it("loads executable V3 templates without fictional agent versions", () => {
    for (const template of WORKFLOW_BUILDER_TEMPLATES) {
      expect(template.definition.schemaVersion).toBe("3");
      for (const node of template.definition.nodes) {
        if (node.type === "AGENT") {
          expect(node.agentVersionId).toBe("");
        }
      }
    }
  });

  it("applies sequential template into draft", () => {
    const draft = applyWorkflowBuilderTemplate(
      createEmptyWorkflowBuilderDraft("ws-1"),
      "sequential-agents",
    );
    expect(draft.definition.nodes).toHaveLength(2);
    const report = analyzeWorkflowBuilderDraft(draft);
    expect(
      report.issues.some((issue) => issue.code === "agent_version_required"),
    ).toBe(true);
  });
});
