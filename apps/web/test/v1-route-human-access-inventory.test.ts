import { describe, expect, it } from "vitest";

import {
  V1_ROUTE_ACCESS_INVENTORY,
  validateV1RouteAccessInventory,
} from "../src/v1-route-human-access-inventory.js";
import { V1_ROUTE_INVENTORY } from "../src/v1-route-inventory.js";
import {
  authorizationActionToHumanPermission,
  HUMAN_WORKSPACE_PERMISSIONS,
  V1_ROUTE_ACCESS_CLASSES,
} from "@osva-ai/contracts";
import { structuralKeyFromInventoryRoute } from "../src/v1-route-structural-key.js";

describe("V1_ROUTE_ACCESS_INVENTORY", () => {
  it("passes structural validation", () => {
    expect(validateV1RouteAccessInventory()).toEqual([]);
  });

  it("covers every control-plane inventory route", () => {
    const controlPlaneKeys = new Set(
      V1_ROUTE_ACCESS_INVENTORY.filter(
        (record) => record.module !== "human-auth-http",
      ).map((record) => structuralKeyFromInventoryRoute(record)),
    );
    for (const route of V1_ROUTE_INVENTORY) {
      expect(controlPlaneKeys.has(structuralKeyFromInventoryRoute(route))).toBe(
        true,
      );
    }
  });

  it("classifies auth context as API-key only", () => {
    const authContext = V1_ROUTE_ACCESS_INVENTORY.find(
      (record) => record.path === "/v1/auth/context",
    );
    expect(authContext?.accessClass).toBe(V1_ROUTE_ACCESS_CLASSES.API_KEY_ONLY);
  });

  it("maps authorization actions to human permissions", () => {
    expect(
      authorizationActionToHumanPermission(
        "ADMIN" as import("@osva-ai/contracts").AuthorizationAction,
      ),
    ).toBe(HUMAN_WORKSPACE_PERMISSIONS.ADMINISTER_WORKSPACE);
  });

  it("assigns workspace permissions to mutating agent routes", () => {
    const createAgent = V1_ROUTE_ACCESS_INVENTORY.find(
      (record) => record.method === "POST" && record.path === "/v1/agents",
    );
    expect(createAgent?.requiredHumanPermission).toBe(
      HUMAN_WORKSPACE_PERMISSIONS.WRITE,
    );
  });
});
