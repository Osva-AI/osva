import { describe, expect, it } from "vitest";

import {
  OSVA_EXAMPLE_CATALOG,
  validateOsvaExampleCatalog,
} from "../src/client/lib/osva-examples-catalog";
import {
  buildExampleReadmeUrl,
  isAllowedOsvaExamplesUrl,
  OSVA_EXAMPLES_AUDITED_SHA,
} from "../src/client/lib/osva-examples-links";

describe("osva examples catalog", () => {
  it("passes schema and link validation", () => {
    expect(validateOsvaExampleCatalog()).toEqual([]);
  });

  it("uses unique ids", () => {
    const ids = OSVA_EXAMPLE_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pins README links to the audited commit", () => {
    for (const entry of OSVA_EXAMPLE_CATALOG) {
      expect(entry.sourceReadmeUrl).toContain(OSVA_EXAMPLES_AUDITED_SHA);
      expect(isAllowedOsvaExamplesUrl(entry.sourceReadmeUrl)).toBe(true);
    }
  });

  it("builds reproducible README paths", () => {
    expect(buildExampleReadmeUrl("examples/04-seo-worker")).toBe(
      `https://github.com/Osva-AI/osva-examples/blob/${OSVA_EXAMPLES_AUDITED_SHA}/examples/04-seo-worker/README.md`,
    );
  });

  it("does not claim live integration verification by default", () => {
    for (const entry of OSVA_EXAMPLE_CATALOG) {
      expect(entry.verification.liveIntegrationVerified).toBe(false);
    }
  });

  it("labels example 19 as OSVA 1.1.x", () => {
    const ex19 = OSVA_EXAMPLE_CATALOG.find(
      (e) => e.id === "19-research-report-agent",
    );
    expect(ex19?.osvaVersion).toBe("1.1.x");
  });
});
