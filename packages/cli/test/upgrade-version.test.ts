import { describe, expect, it } from "vitest";

import { comparePlatformVersions } from "../src/platform/upgrade/version.js";

describe("platform version compare", () => {
  it("orders semver releases and prereleases", () => {
    expect(comparePlatformVersions("1.1.0-rc.4", "1.1.0")).toBe(-1);
    expect(comparePlatformVersions("1.1.0", "1.1.0-rc.4")).toBe(1);
    expect(comparePlatformVersions("1.0.0", "1.1.0")).toBe(-1);
    expect(comparePlatformVersions("1.1.0", "1.1.0")).toBe(0);
  });
});
