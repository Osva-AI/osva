import type { WorkspaceId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  classifyAdministratorBootstrapPhase,
  parseInstallationStatusJson,
} from "../src/setup/installation-status.js";

describe("installation status classification", () => {
  it("classifies fresh, linked, pending setup, and multi-workspace states", () => {
    expect(
      classifyAdministratorBootstrapPhase({
        schemaVersion: 1,
        workspaceCount: 0,
        apiKeyCount: 0,
        organizationCount: 0,
        humanUserCount: 0,
        pendingSetupUserCount: 0,
        unlinkedWorkspaceIds: [],
      }),
    ).toBe("fresh_installation");

    expect(
      classifyAdministratorBootstrapPhase({
        schemaVersion: 1,
        workspaceCount: 1,
        apiKeyCount: 1,
        organizationCount: 0,
        humanUserCount: 0,
        pendingSetupUserCount: 0,
        unlinkedWorkspaceIds: [
          "11111111-1111-1111-1111-111111111111" as WorkspaceId,
        ],
      }),
    ).toBe("workspace_without_human_administrator");

    expect(
      classifyAdministratorBootstrapPhase({
        schemaVersion: 1,
        workspaceCount: 2,
        apiKeyCount: 2,
        organizationCount: 0,
        humanUserCount: 0,
        pendingSetupUserCount: 0,
        unlinkedWorkspaceIds: [
          "11111111-1111-1111-1111-111111111111" as WorkspaceId,
          "22222222-2222-2222-2222-222222222222" as WorkspaceId,
        ],
      }),
    ).toBe("multiple_unlinked_workspaces");

    expect(
      classifyAdministratorBootstrapPhase({
        schemaVersion: 1,
        workspaceCount: 1,
        apiKeyCount: 1,
        organizationCount: 1,
        humanUserCount: 1,
        pendingSetupUserCount: 1,
        unlinkedWorkspaceIds: [],
      }),
    ).toBe("administrator_pending_password_setup");

    expect(
      classifyAdministratorBootstrapPhase({
        schemaVersion: 1,
        workspaceCount: 1,
        apiKeyCount: 1,
        organizationCount: 1,
        humanUserCount: 1,
        pendingSetupUserCount: 0,
        unlinkedWorkspaceIds: [],
      }),
    ).toBe("administrator_ready");
  });

  it("parses installation status JSON from compose run stdout", () => {
    const snapshot = parseInstallationStatusJson(
      'info\n{"schemaVersion":1,"workspaceCount":1,"apiKeyCount":1,"organizationCount":0,"humanUserCount":0,"pendingSetupUserCount":0,"unlinkedWorkspaceIds":["11111111-1111-1111-1111-111111111111"]}\n',
    );
    expect(snapshot.unlinkedWorkspaceIds).toHaveLength(1);
  });
});
