import { describe, expect, it } from "vitest";
import { TOOL_ERROR_CODES } from "@osva-ai/contracts";

import {
  buildAgentPickerHandoffPath,
  buildAgentVersionCreateHandoffPath,
  parseToolVersionHandoffParam,
  toolVersionHandoffSearch,
  validateToolVersionHandoff,
} from "../src/client/lib/connector-agent-handoff";
import {
  describeJourneyEvidenceLabel,
  describeStdioOperatorBoundary,
  deriveRecommendedSetupStep,
} from "../src/client/lib/connector-guided-setup";
import { resolveCatalogWorkspaceIntegration } from "../src/client/lib/connector-workspace-status";
import {
  CONNECTOR_CATALOG,
  CONNECTOR_CATALOG_PROVENANCE,
  getConnectorCatalogEntry,
  validateConnectorCatalog,
} from "../src/client/lib/osva-connectors-catalog";
import {
  describeRunStepToolErrorGuidance,
  buildRunStepToolDiagnosticsView,
} from "../src/client/lib/execution-diagnostics";
import { roleCanWriteControlPlaneResources } from "../src/client/lib/permissions";
import { OSVA_CONNECTORS_AUDITED_SHA } from "../src/client/lib/osva-connectors-links";
import catalogSnapshot from "../src/client/data/osva-connectors-catalog.snapshot.json";

/**
 * B6.3D offline acceptance: provenance, security invariants, and
 * evidence-based journey labels (no provider network calls).
 */
describe("B6.3D catalog provenance", () => {
  it("pins exactly 45 published connectors at schema v2", () => {
    expect(validateConnectorCatalog()).toEqual([]);
    expect(catalogSnapshot.schemaVersion).toBe(2);
    expect(CONNECTOR_CATALOG_PROVENANCE.connectorCount).toBe(45);
    expect(CONNECTOR_CATALOG.length).toBe(45);
    expect(CONNECTOR_CATALOG_PROVENANCE.auditedCommitSha).toBe(
      OSVA_CONNECTORS_AUDITED_SHA,
    );
  });

  it("qualifies heuristic mutation metadata on catalog entries", () => {
    const github = getConnectorCatalogEntry("github");
    expect(github?.mutationClassificationHeuristic).toBe(true);
    expect(github?.toolRisk).toBeDefined();
  });

  it("does not embed live acceptance claims in catalog JSON", () => {
    const serialized = JSON.stringify(CONNECTOR_CATALOG);
    expect(serialized).not.toMatch(/live.provider.accepted/i);
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
  });
});

describe("B6.3D security and workspace isolation", () => {
  const workspaceCatalog = [
    {
      tool: {
        id: "tool-ws",
        workspaceId: "ws-a",
        key: "echo",
        name: "Echo",
        createdAt: "",
      },
      versions: [
        {
          id: "tv-ws-a",
          toolId: "tool-ws",
          version: 1,
          type: "MCP" as const,
          implementation: "MCP_V1" as const,
          mcp: {
            connectorVersionId: "cv-1",
            remoteToolName: "echo",
            inputSchema: {},
          },
          createdAt: "",
        },
      ],
    },
  ];

  it("rejects cross-workspace ToolVersion navigation hints", () => {
    const { validated, rejected } = validateToolVersionHandoff(
      ["tv-ws-a", "tv-foreign"],
      workspaceCatalog,
    );
    expect(validated).toHaveLength(1);
    expect(rejected).toEqual(["tv-foreign"]);
  });

  it("does not place secrets in handoff URLs", () => {
    const query = toolVersionHandoffSearch(["tv-1", "tv-2"]);
    expect(query).not.toMatch(/secret|token|password|apikey/i);
    expect(query).toBe("?toolVersionIds=tv-1%2Ctv-2");
  });

  it("blocks VIEWER from control-plane writes used in connector journey", () => {
    expect(roleCanWriteControlPlaneResources("VIEWER")).toBe(false);
    expect(roleCanWriteControlPlaneResources("DEVELOPER")).toBe(true);
  });

  it("does not auto-construct agent runs from binding hints", () => {
    expect(buildAgentPickerHandoffPath(["tv-1"])).toBe(
      "/agents?toolVersionIds=tv-1",
    );
    expect(buildAgentVersionCreateHandoffPath("a1", ["tv-1"])).not.toMatch(
      /\/runs/,
    );
    expect(parseToolVersionHandoffParam("")).toEqual([]);
  });
});

describe("B6.3D scenario C — prerequisite evidence (not fabricated health)", () => {
  it("maps catalog-only when workspace key does not match", () => {
    expect(
      describeJourneyEvidenceLabel("no-linked-workspace-connector"),
    ).toMatch(/connectorKey match only/i);
    expect(deriveRecommendedSetupStep("catalog-only")).toBe("workspace");
  });

  it("maps missing ConnectorVersion without claiming connectivity", () => {
    const status = resolveCatalogWorkspaceIntegration({
      catalogConnectorKey: "osva-connector-github",
      workspaceConnectors: [
        {
          id: "c1",
          workspaceId: "w1",
          key: "osva-connector-github",
          name: "GitHub",
          createdAt: "",
          updatedAt: "",
        },
      ],
      connectorVersionsByConnectorId: new Map(),
      mcpToolVersions: [],
    });
    expect(status.status).toBe("identity-created");
    expect(describeJourneyEvidenceLabel("workspace-connector-created")).toMatch(
      /no ConnectorVersion/i,
    );
  });

  it("states STDIO operator boundary without browser execution", () => {
    expect(describeStdioOperatorBoundary()).toMatch(/cannot enable this flag/i);
    expect(describeStdioOperatorBoundary()).not.toMatch(/npm install/i);
  });

  it("qualifies tools-imported as separate from live provider health", () => {
    expect(describeJourneyEvidenceLabel("tools-imported")).toMatch(
      /connectivity not verified/i,
    );
    expect(describeJourneyEvidenceLabel("ready-for-agent-binding")).toMatch(
      /execution auth is separate/i,
    );
  });
});

describe("B6.3D scenario D — custom workspace connector keys", () => {
  it("keeps custom-key connectors usable in workspace without catalog association", () => {
    const custom = resolveCatalogWorkspaceIntegration({
      catalogConnectorKey: "osva-connector-github",
      workspaceConnectors: [
        {
          id: "custom-1",
          workspaceId: "w1",
          key: "team-github-prod",
          name: "Team GitHub",
          createdAt: "",
          updatedAt: "",
        },
      ],
      connectorVersionsByConnectorId: new Map([
        ["custom-1", [{ id: "cv-custom" }]],
      ]),
      mcpToolVersions: [
        {
          id: "tv-custom",
          toolId: "t1",
          version: 1,
          type: "MCP",
          implementation: "MCP_V1",
          mcp: {
            connectorVersionId: "cv-custom",
            remoteToolName: "list_issues",
            inputSchema: {},
          },
          createdAt: "",
        },
      ],
    });
    expect(custom.status).toBe("catalog-only");
    expect(custom.importedMcpToolCount).toBe(0);
  });
});

describe("B6.3D diagnostic accuracy", () => {
  it("maps stable ToolGateway codes and avoids inventing correlation ids", () => {
    const auth = describeRunStepToolErrorGuidance(
      TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
    );
    expect(auth?.title).toMatch(/authorization denied/i);
    expect(JSON.stringify(auth)).not.toMatch(/correlation/i);

    const unknown = describeRunStepToolErrorGuidance("SOME_UNKNOWN_CODE");
    expect(unknown).toBeUndefined();
  });

  it("builds tool RunStep views from public fields only", () => {
    const view = buildRunStepToolDiagnosticsView({
      id: "step-1",
      kind: "TOOL",
      bindingName: "echo",
      status: "FAILED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      toolVersionId: "tv-1",
      errorCode: TOOL_ERROR_CODES.CONNECTOR_UNAVAILABLE,
    });
    expect(view?.toolVersionId).toBe("tv-1");
    expect(view?.guidance?.title).toMatch(/unreachable/i);
    expect(JSON.stringify(view)).not.toMatch(/raw/i);
  });
});
