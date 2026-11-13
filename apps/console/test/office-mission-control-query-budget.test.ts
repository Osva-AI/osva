import { describe, expect, it } from "vitest";

import { estimateOfficeMissionControlHttpReads } from "../src/client/lib/office-mission-control-query-budget";

describe("office mission control query budget", () => {
  it("stays bounded at 25 tasks with no workflow launches", () => {
    const estimate = estimateOfficeMissionControlHttpReads({
      teamCount: 3,
      distinctLaunchedWorkflowRunCount: 0,
      includeMissionControlRecentSections: true,
    });
    expect(estimate.workflowRunGets).toBe(0);
    expect(estimate.workflowVersionGets).toBe(0);
    expect(estimate.totalDistinctGets).toBe(10);
  });

  it("scales workflow GETs with launched workflow tasks, not raw task count at 25 tasks", () => {
    const at25 = estimateOfficeMissionControlHttpReads({
      teamCount: 3,
      distinctLaunchedWorkflowRunCount: 5,
      includeMissionControlRecentSections: true,
    });
    const at100 = estimateOfficeMissionControlHttpReads({
      teamCount: 3,
      distinctLaunchedWorkflowRunCount: 5,
      includeMissionControlRecentSections: true,
    });
    expect(at25.totalDistinctGets).toBe(20);
    expect(at100.totalDistinctGets).toBe(at25.totalDistinctGets);
    expect(at25.workflowRunGets).toBe(5);
    expect(at25.workflowVersionGets).toBe(5);
  });

  it("at 100 tasks with 20 workflow launches remains O(workflow) not O(100)", () => {
    const estimate = estimateOfficeMissionControlHttpReads({
      teamCount: 3,
      distinctLaunchedWorkflowRunCount: 20,
      includeMissionControlRecentSections: true,
    });
    expect(estimate.workflowRunGets).toBe(20);
    expect(estimate.workflowVersionGets).toBe(20);
    expect(estimate.totalDistinctGets).toBe(50);
    expect(estimate.assignments).toBe(1);
  });
});
