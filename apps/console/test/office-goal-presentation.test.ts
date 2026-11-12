import { describe, expect, it } from "vitest";

import {
  isLegalGoalTransition,
  selectableGoalStatuses,
} from "../src/client/lib/office-presentation.js";

describe("goal presentation", () => {
  it("mirrors legal goal transitions from domain", () => {
    expect(isLegalGoalTransition("OPEN", "ACTIVE")).toBe(true);
    expect(isLegalGoalTransition("OPEN", "COMPLETED")).toBe(true);
    expect(isLegalGoalTransition("ACTIVE", "CANCELLED")).toBe(true);
    expect(isLegalGoalTransition("COMPLETED", "OPEN")).toBe(false);
    expect(isLegalGoalTransition("CANCELLED", "ACTIVE")).toBe(false);
  });

  it("includes only legal selectable statuses", () => {
    expect(selectableGoalStatuses("OPEN")).toEqual(
      expect.arrayContaining(["OPEN", "ACTIVE", "COMPLETED", "CANCELLED"]),
    );
    expect(selectableGoalStatuses("COMPLETED")).toEqual(["COMPLETED"]);
  });
});
