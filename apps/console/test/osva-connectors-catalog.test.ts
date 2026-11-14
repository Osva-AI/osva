import { describe, expect, it } from "vitest";

import {
  CONNECTOR_CATALOG,
  CONNECTOR_CATALOG_PROVENANCE,
  filterConnectorCatalogEntries,
  getConnectorCatalogEntry,
  validateConnectorCatalog,
} from "../src/client/lib/osva-connectors-catalog";
import {
  buildConnectorInstallGuideUrl,
  isAllowedOsvaConnectorsUrl,
  OSVA_CONNECTORS_AUDITED_SHA,
} from "../src/client/lib/osva-connectors-links";
import { resolveCatalogWorkspaceIntegration } from "../src/client/lib/connector-workspace-status";
import { getExampleById } from "../src/client/lib/osva-examples-catalog";
import catalogSnapshot from "../src/client/data/osva-connectors-catalog.snapshot.json";

describe("osva connectors catalog", () => {
  it("passes schema and link validation", () => {
    expect(validateConnectorCatalog()).toEqual([]);
  });

  it("pins provenance to audited commit", () => {
    expect(CONNECTOR_CATALOG_PROVENANCE.auditedCommitSha).toBe(
      OSVA_CONNECTORS_AUDITED_SHA,
    );
    expect(CONNECTOR_CATALOG_PROVENANCE.connectorCount).toBe(45);
    expect(catalogSnapshot.connectors.length).toBe(45);
  });

  it("uses unique connector ids and keys", () => {
    const ids = CONNECTOR_CATALOG.map((e) => e.connectorId);
    const keys = CONNECTOR_CATALOG.map((e) => e.connectorKey);
    expect(new Set(ids).size).toBe(45);
    expect(new Set(keys).size).toBe(45);
  });

  it("filters by provider search", () => {
    const github = filterConnectorCatalogEntries({
      query: "github",
      capability: "all",
      transport: "all",
    });
    expect(github.some((e) => e.connectorId === "github")).toBe(true);
  });

  it("resolves github catalog entry with install guide", () => {
    const entry = getConnectorCatalogEntry("github");
    expect(entry?.connectorKey).toBe("osva-connector-github");
    expect(entry?.publishedVersion).toBe(
      catalogSnapshot.connectors.find((c) => c.connectorId === "github")
        ?.publishedVersion,
    );
    expect(isAllowedOsvaConnectorsUrl(entry?.installGuideUrl ?? "")).toBe(true);
    expect(buildConnectorInstallGuideUrl("docs/INSTALL-GITHUB.md")).toContain(
      OSVA_CONNECTORS_AUDITED_SHA,
    );
  });

  it("maps workspace integration by connectorKey only", () => {
    const resolved = resolveCatalogWorkspaceIntegration({
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
    expect(resolved.status).toBe("identity-created");
    expect(resolved.workspaceConnectorId).toBe("c1");
  });

  it("does not treat unrelated workspace keys as matches", () => {
    const resolved = resolveCatalogWorkspaceIntegration({
      catalogConnectorKey: "osva-connector-github",
      workspaceConnectors: [
        {
          id: "c2",
          workspaceId: "w1",
          key: "my-github",
          name: "GitHub display",
          createdAt: "",
          updatedAt: "",
        },
      ],
      connectorVersionsByConnectorId: new Map(),
      mcpToolVersions: [],
    });
    expect(resolved.status).toBe("catalog-only");
  });

  it("links npm github shopify ga4 examples", () => {
    expect(getConnectorCatalogEntry("npm")?.relatedExampleIds).toContain(
      "19-research-report-agent",
    );
    expect(getConnectorCatalogEntry("github")?.relatedExampleIds).toContain(
      "20-github-repository-analyst",
    );
    expect(getConnectorCatalogEntry("shopify")?.relatedExampleIds).toContain(
      "21-commerce-growth-analyst",
    );
    expect(getExampleById("20-github-repository-analyst")).toBeDefined();
    expect(getExampleById("21-commerce-growth-analyst")).toBeDefined();
  });

  it("never exposes credential values in catalog entries", () => {
    const text = JSON.stringify(CONNECTOR_CATALOG);
    expect(text).not.toMatch(/sk-[a-z0-9]/i);
    expect(text).not.toContain("BEGIN PRIVATE KEY");
  });
});
