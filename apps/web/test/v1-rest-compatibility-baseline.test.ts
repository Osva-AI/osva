import { describe, expect, it } from "vitest";

import {
  V1_REST_COMPATIBILITY_BASELINE,
  v1RestCompatibilityBaselineKey,
} from "../src/v1-rest-compatibility-baseline.js";
import {
  V1_ROUTE_INVENTORY,
  routeInventoryKey,
} from "../src/v1-route-inventory.js";

describe("V1 REST compatibility baseline", () => {
  it("covers every inventory route exactly once", () => {
    const inventoryKeys = V1_ROUTE_INVENTORY.map(routeInventoryKey).sort();
    const baselineKeys = V1_REST_COMPATIBILITY_BASELINE.map(
      v1RestCompatibilityBaselineKey,
    ).sort();

    expect(baselineKeys).toEqual(inventoryKeys);
  });

  it("requires authentication on every stable route", () => {
    for (const entry of V1_REST_COMPATIBILITY_BASELINE) {
      expect(entry.authenticationRequired).toBe(true);
      expect(entry.resourceFamily.length).toBeGreaterThan(0);
      expect(entry.minAuthorizationAction.length).toBeGreaterThan(0);
    }
  });
});
