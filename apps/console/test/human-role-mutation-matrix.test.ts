import { describe, expect, it } from "vitest";

import { HUMAN_WORKSPACE_ROLES } from "@osva-ai/contracts";

import {
  ALL_HUMAN_WORKSPACE_ROLES,
  CONSOLE_MUTATION_CONTROLS,
  CONSOLE_MUTATION_CONTROL_IDS,
} from "../src/client/lib/console-mutation-controls";

describe("Console human role mutation matrix", () => {
  it("covers every workspace role exactly once per control", () => {
    expect(ALL_HUMAN_WORKSPACE_ROLES).toEqual(
      expect.arrayContaining(Object.values(HUMAN_WORKSPACE_ROLES)),
    );
    expect(ALL_HUMAN_WORKSPACE_ROLES.length).toBe(5);
    for (const control of CONSOLE_MUTATION_CONTROLS) {
      for (const role of ALL_HUMAN_WORKSPACE_ROLES) {
        expect(typeof control.visibleForRole(role)).toBe("boolean");
      }
    }
  });

  it("classifies OWNER directly for ownership and member administration", () => {
    const ownerOnly = [
      CONSOLE_MUTATION_CONTROL_IDS.MEMBER_GRANT_OWNER,
      CONSOLE_MUTATION_CONTROL_IDS.OWNERSHIP_TRANSFER,
    ];
    for (const id of ownerOnly) {
      const spec = CONSOLE_MUTATION_CONTROLS.find((item) => item.id === id);
      expect(spec).toBeDefined();
      expect(spec!.visibleForRole(HUMAN_WORKSPACE_ROLES.OWNER)).toBe(true);
      expect(spec!.visibleForRole(HUMAN_WORKSPACE_ROLES.ADMIN)).toBe(false);
    }
    const manageMembers = CONSOLE_MUTATION_CONTROLS.find(
      (item) => item.id === CONSOLE_MUTATION_CONTROL_IDS.MEMBER_PROVISION,
    )!;
    expect(manageMembers.visibleForRole(HUMAN_WORKSPACE_ROLES.ADMIN)).toBe(
      true,
    );
    expect(manageMembers.visibleForRole(HUMAN_WORKSPACE_ROLES.OWNER)).toBe(
      true,
    );
    expect(manageMembers.visibleForRole(HUMAN_WORKSPACE_ROLES.VIEWER)).toBe(
      false,
    );
  });

  it("maps write vs execute vs read without role-name ordering", () => {
    const writeControl = CONSOLE_MUTATION_CONTROLS.find(
      (item) => item.id === CONSOLE_MUTATION_CONTROL_IDS.WORKFLOW_CREATE,
    )!;
    expect(writeControl.visibleForRole(HUMAN_WORKSPACE_ROLES.DEVELOPER)).toBe(
      true,
    );
    expect(writeControl.visibleForRole(HUMAN_WORKSPACE_ROLES.OPERATOR)).toBe(
      false,
    );

    const executeControl = CONSOLE_MUTATION_CONTROLS.find(
      (item) => item.id === CONSOLE_MUTATION_CONTROL_IDS.WORKFLOW_EVENT_EMIT,
    )!;
    expect(executeControl.visibleForRole(HUMAN_WORKSPACE_ROLES.OPERATOR)).toBe(
      true,
    );
    expect(executeControl.visibleForRole(HUMAN_WORKSPACE_ROLES.VIEWER)).toBe(
      false,
    );

    const auditNav = CONSOLE_MUTATION_CONTROLS.find(
      (item) => item.id === CONSOLE_MUTATION_CONTROL_IDS.NAV_SECURITY_ACTIVITY,
    )!;
    expect(auditNav.visibleForRole(HUMAN_WORKSPACE_ROLES.VIEWER)).toBe(true);
  });

  it("requires an explicit registry entry for every mutation control id", () => {
    const ids = new Set(CONSOLE_MUTATION_CONTROLS.map((item) => item.id));
    for (const required of Object.values(CONSOLE_MUTATION_CONTROL_IDS)) {
      expect(ids.has(required)).toBe(true);
    }
    expect(CONSOLE_MUTATION_CONTROLS.length).toBe(
      Object.keys(CONSOLE_MUTATION_CONTROL_IDS).length,
    );
  });
});
