import { describe, expect, it } from "vitest";

import { HUMAN_WORKSPACE_PERMISSIONS } from "../src/human-identity.js";
import {
  authorizationActionToHumanPermission,
  V1_ROUTE_ACCESS_CLASSES,
  isHumanPermittedControlPlaneAccessClass,
} from "../src/v1-control-plane-human-access.js";
import { AUTHORIZATION_ACTIONS } from "../src/security.js";

describe("v1 control-plane human access contracts", () => {
  it("maps authorization actions to human permissions", () => {
    expect(
      authorizationActionToHumanPermission(AUTHORIZATION_ACTIONS.READ),
    ).toBe(HUMAN_WORKSPACE_PERMISSIONS.READ);
    expect(
      authorizationActionToHumanPermission(AUTHORIZATION_ACTIONS.EXECUTE),
    ).toBe(HUMAN_WORKSPACE_PERMISSIONS.EXECUTE);
    expect(
      authorizationActionToHumanPermission(AUTHORIZATION_ACTIONS.WRITE),
    ).toBe(HUMAN_WORKSPACE_PERMISSIONS.WRITE);
    expect(
      authorizationActionToHumanPermission(AUTHORIZATION_ACTIONS.ADMIN),
    ).toBe(HUMAN_WORKSPACE_PERMISSIONS.ADMINISTER_WORKSPACE);
  });

  it("identifies control-plane workspace access class", () => {
    expect(
      isHumanPermittedControlPlaneAccessClass(
        V1_ROUTE_ACCESS_CLASSES.CONTROL_PLANE_WORKSPACE,
      ),
    ).toBe(true);
    expect(
      isHumanPermittedControlPlaneAccessClass(
        V1_ROUTE_ACCESS_CLASSES.API_KEY_ONLY,
      ),
    ).toBe(false);
  });
});
