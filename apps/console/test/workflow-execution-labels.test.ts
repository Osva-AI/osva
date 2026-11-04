import { describe, expect, it } from "vitest";

import {
  describeMissingApprovalRequestCopy,
  workflowNodeDisplayTitle,
  workflowRunExecutionStatusLabel,
} from "../src/client/lib/workflow-execution-labels";

describe("workflow execution labels", () => {
  it("maps WorkflowRun statuses for detail header", () => {
    expect(workflowRunExecutionStatusLabel("WAITING")).toBe("Waiting");
    expect(workflowRunExecutionStatusLabel("SUCCEEDED")).toBe("Succeeded");
  });

  it("uses neutral copy when approval records are missing", () => {
    expect(describeMissingApprovalRequestCopy("SUCCEEDED")).toBe(
      "No approval request record is included in the workflow run detail for this node.",
    );
    expect(describeMissingApprovalRequestCopy("WAITING")).toBe(
      "Approval request has not been returned for this waiting node.",
    );
    expect(describeMissingApprovalRequestCopy(undefined)).toContain(
      "No approval request record is available",
    );
  });

  it("prefers approval titles over raw keys", () => {
    expect(
      workflowNodeDisplayTitle({
        key: "approval",
        type: "APPROVAL",
        title: "Review before continuing",
      }),
    ).toBe("Review before continuing");
  });
});
