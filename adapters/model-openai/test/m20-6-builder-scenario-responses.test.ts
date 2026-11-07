import { describe, expect, it } from "vitest";

import { resolveM20_6BuilderFakeProposal } from "./m20-6-builder-scenario-responses.js";
import type { ModelProfileVersionId } from "@osva-ai/contracts";

describe("M20.6 fake builder responses", () => {
  it("refinement path applies fact-check turn", () => {
    const exec = "mpv-test" as ModelProfileVersionId;
    const catalog = `=== CAPABILITY_CATALOG_JSON ===
{"modelProfileVersions":[{"modelProfileVersionId":"${exec}"}]}
=== END_CAPABILITY_CATALOG_JSON ===`;
    const base = resolveM20_6BuilderFakeProposal(
      `${catalog}\nOSVA_M20_6_SCENARIO=sequential`,
    )!;
    const userText = `=== CAPABILITY_CATALOG_JSON ===
{"modelProfileVersions":[{"modelProfileVersionId":"${exec}"}]}
=== END_CAPABILITY_CATALOG_JSON ===
=== CURRENT_BUILDER_PROPOSAL_JSON ===
${JSON.stringify(base)}
=== END_CURRENT_BUILDER_PROPOSAL_JSON ===
=== REFINEMENT_INSTRUCTION ===
Add a fact-checking agent after the report step.
=== END_REFINEMENT_INSTRUCTION ===`;

    const next = resolveM20_6BuilderFakeProposal(userText);
    expect(next).toBeDefined();
    expect(
      next!.agents.some((a) => a.kind === "NEW" && a.agentKey === "fact_check"),
    ).toBe(true);
  });
});
