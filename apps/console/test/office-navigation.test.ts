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

  it("marks missions and tasks routes as active", () => {
    const missions = OFFICE_NAV_ITEMS.find(
      (item) => item.navId === "office-missions",
    )!;
    const tasks = OFFICE_NAV_ITEMS.find(
      (item) => item.navId === "office-tasks",
    )!;
    expect(navItemMatchesPath(missions, "/office/missions/goal-1")).toBe(true);
    expect(navItemMatchesPath(tasks, "/office/tasks")).toBe(true);
    expect(navItemMatchesPath(tasks, "/office/tasks/new")).toBe(true);
    expect(navItemMatchesPath(tasks, "/office/tasks/asn-1")).toBe(true);
  });
});
