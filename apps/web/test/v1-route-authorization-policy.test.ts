import {
  AUTHORIZATION_ACTIONS,
  HUMAN_WORKSPACE_PERMISSIONS,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { inferV1RouteAuthorizationAction } from "../src/v1-route-authorization-policy.js";
import { lookupV1RouteAccess } from "../src/v1-route-human-access-inventory.js";
import { structuralRouteKeyFromPathname } from "../src/v1-route-structural-key.js";

describe("inferV1RouteAuthorizationAction", () => {
  it("classifies knowledge retrieve as EXECUTE rather than POST default WRITE", () => {
    const key = structuralRouteKeyFromPathname(
      "POST",
      "/v1/knowledge/retrieve",
    );
    expect(inferV1RouteAuthorizationAction("POST", key)).toBe(
      AUTHORIZATION_ACTIONS.EXECUTE,
    );
  });

  it("maps knowledge retrieve inventory record to EXECUTE human permission", () => {
    const access = lookupV1RouteAccess("POST", "/v1/knowledge/retrieve");
    expect(access?.requiredAuthorizationAction).toBe(
      AUTHORIZATION_ACTIONS.EXECUTE,
    );
    expect(access?.requiredHumanPermission).toBe(
      HUMAN_WORKSPACE_PERMISSIONS.EXECUTE,
    );
  });
});
