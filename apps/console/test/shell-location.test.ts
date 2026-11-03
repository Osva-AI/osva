import { describe, expect, it } from "vitest";

import {
  shellBreadcrumbFromPath,
  shellPageLabelFromPath,
} from "../src/client/lib/shell-location";

describe("shellBreadcrumbFromPath", () => {
  it("maps overview to Home", () => {
    expect(shellBreadcrumbFromPath("/overview")).toEqual({ section: "Home" });
  });

  it("adds create detail for workflow builder routes", () => {
    expect(shellBreadcrumbFromPath("/workflows/new")).toEqual({
      section: "Workflows",
      detail: "Create workflow",
    });
  });
});

describe("shellPageLabelFromPath", () => {
  it("uses workspace page labels from the V2 shell", () => {
    expect(shellPageLabelFromPath("/overview")).toBe("Home");
    expect(shellPageLabelFromPath("/agents/new")).toBe("Agent Studio");
    expect(shellPageLabelFromPath("/workflows/new")).toBe("Workflow Studio");
    expect(shellPageLabelFromPath("/onboarding")).toBe("Guided setup");
  });
});
