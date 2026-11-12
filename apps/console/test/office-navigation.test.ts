import { describe, expect, it } from "vitest";

import {
  isOfficeRoute,
  navItemMatchesPath,
  OFFICE_NAV_ITEMS,
} from "../src/client/lib/console-navigation";

describe("Virtual Office navigation", () => {
  it("detects office routes", () => {
    expect(isOfficeRoute("/office")).toBe(true);
    expect(isOfficeRoute("/office/teams/team-1")).toBe(true);
    expect(isOfficeRoute("/agents")).toBe(false);
  });

  it("keeps Mission Control active only on /office", () => {
    const mission = OFFICE_NAV_ITEMS[0]!;
    expect(navItemMatchesPath(mission, "/office")).toBe(true);
    expect(navItemMatchesPath(mission, "/office/teams")).toBe(false);
  });

  it("marks team and worker routes as active on nested paths", () => {
    const teams = OFFICE_NAV_ITEMS.find(
      (item) => item.navId === "office-teams",
    )!;
    const workers = OFFICE_NAV_ITEMS.find(
      (item) => item.navId === "office-workers",
    )!;
    expect(navItemMatchesPath(teams, "/office/teams/team-1")).toBe(true);
    expect(navItemMatchesPath(workers, "/office/workers/ow-1")).toBe(true);
  });
});
