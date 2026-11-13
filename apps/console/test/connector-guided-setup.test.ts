import { describe, expect, it } from "vitest";

import {
  buildVerifiedWorkerPackageInstallCommand,
  connectorDiscoverHandoffPath,
  connectorSetupStepComplete,
  deriveRecommendedSetupStep,
  describeAuthenticationGuidance,
  describeStdioOperatorBoundary,
  mapIntegrationStatusToJourneyLabel,
  parseSetupStepId,
  resolveSetupStepVisualState,
  streamableHttpOfferedForCatalogTransport,
} from "../src/client/lib/connector-guided-setup";
import { getConnectorCatalogEntry } from "../src/client/lib/osva-connectors-catalog";

const github = getConnectorCatalogEntry("github");

describe("connector guided setup", () => {
  it("builds verified npm install command from catalog metadata", () => {
    expect(github).toBeDefined();
    const command = buildVerifiedWorkerPackageInstallCommand(github!);
    expect(command).toBe(
      `npm install ${github!.npmPackage}@${github!.publishedVersion}`,
    );
    expect(command).not.toMatch(/curl|bash|powershell/i);
  });

  it("parses setup step query values", () => {
    expect(parseSetupStepId("workspace")).toBe("workspace");
    expect(parseSetupStepId("invalid")).toBeUndefined();
    expect(parseSetupStepId(null)).toBeUndefined();
  });

  it("recommends steps from integration evidence", () => {
    expect(deriveRecommendedSetupStep("catalog-only")).toBe("workspace");
    expect(deriveRecommendedSetupStep("identity-created")).toBe("transport");
    expect(deriveRecommendedSetupStep("version-configured")).toBe("discover");
    expect(deriveRecommendedSetupStep("tools-imported")).toBe("discover");
  });

  it("maps journey labels without connected claims", () => {
    const label = mapIntegrationStatusToJourneyLabel("tools-imported");
    expect(label).toBe("tools-imported");
    expect(describeStdioOperatorBoundary()).toMatch(
      /OSVA_MCP_STDIO_CONNECTORS_ENABLED/i,
    );
  });

  it("distinguishes auth guidance from mandatory secrets", () => {
    const lines = describeAuthenticationGuidance(github!);
    expect(lines.some((line) => /not proof/i.test(line))).toBe(true);
  });

  it("does not offer HTTP bridge for stdio catalog transport", () => {
    expect(streamableHttpOfferedForCatalogTransport("stdio")).toBe(false);
    expect(streamableHttpOfferedForCatalogTransport("streamable_http")).toBe(
      true,
    );
  });

  it("marks workspace step complete only with linked identity", () => {
    expect(
      connectorSetupStepComplete({
        stepId: "workspace",
        integrationStatus: "catalog-only",
        transport: "stdio",
        linkedVersions: [],
      }),
    ).toBe(false);
    expect(
      connectorSetupStepComplete({
        stepId: "workspace",
        integrationStatus: "identity-created",
        transport: "stdio",
        linkedVersions: [],
      }),
    ).toBe(true);
  });

  it("requires STDIO ConnectorVersion for transport completion", () => {
    expect(
      connectorSetupStepComplete({
        stepId: "transport",
        integrationStatus: "identity-created",
        transport: "stdio",
        linkedVersions: [
          {
            id: "cv-1",
            connectorId: "c-1",
            version: 1,
            kind: "MCP",
            transport: "STDIO",
            transportConfig: {
              command: "node",
              args: ["index.js"],
            },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    ).toBe(true);
  });

  it("builds discover handoff deep link", () => {
    expect(connectorDiscoverHandoffPath("conn-1")).toBe(
      "/tools/connectors/conn-1#discover-import",
    );
  });

  it("tracks step visual states from focus", () => {
    const visual = resolveSetupStepVisualState("workspace", {
      integrationStatus: "catalog-only",
      transport: "stdio",
      linkedVersions: [],
      focusStepId: "workspace",
    });
    expect(visual).toBe("current");
  });
});
