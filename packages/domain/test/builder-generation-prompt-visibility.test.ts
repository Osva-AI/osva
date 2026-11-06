import type {
  AgentVersionId,
  ModelProfileId,
  ModelProfileVersionId,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { buildBuilderCatalogIndex } from "../src/builder/builder-compiler.js";
import { validateProposalResourcePromptVisibility } from "../src/builder/builder-generation-prompt-visibility.js";
import type { BuilderProposalV1 } from "../src/builder/builder-proposal.js";
import type { WorkspaceBuilderCapabilityCatalogV1 } from "../src/builder/workspace-builder-capability-catalog.js";
import { minimalNewAgent } from "./builder-natural-language-test-helpers.js";
import { workspaceId } from "./fixtures.js";

const ws: WorkspaceId = workspaceId;

function emptyPromptVisible() {
  return {
    agentVersionIds: new Set<AgentVersionId>(),
    modelProfileVersionIds: new Set<ModelProfileVersionId>(),
    toolVersionIds: new Set<ToolVersionId>(),
  };
}

describe("validateProposalResourcePromptVisibility", () => {
  it("fails when a workspace-known model profile version was omitted from the prompt catalog", () => {
    const mpvInWorkspace = "mpv-ws" as ModelProfileVersionId;
    const catalog: WorkspaceBuilderCapabilityCatalogV1 = {
      workspaceId: ws,
      agentVersions: [],
      modelProfileVersions: [
        {
          modelProfileVersionId: mpvInWorkspace,
          modelProfileId: "mp-a" as ModelProfileId,
          modelProfileKey: "k",
          modelProfileName: "n",
          version: 1,
          provider: "OPENAI",
          model: "gpt",
        },
      ],
      toolVersions: [],
    };
    const index = buildBuilderCatalogIndex(catalog);
    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "w", name: "W" },
      agents: [
        {
          ...minimalNewAgent("bpr_t"),
          model: {
            bindingName: "default",
            modelProfileVersionId: mpvInWorkspace,
          },
        },
      ],
      workflow: {
        nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_t" }],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const r = validateProposalResourcePromptVisibility(
      proposal,
      emptyPromptVisible(),
      index,
    );
    expect(r.ok).toBe(false);
  });

  it("does not fail visibility for ids absent from the full workspace catalog", () => {
    const catalog: WorkspaceBuilderCapabilityCatalogV1 = {
      workspaceId: ws,
      agentVersions: [],
      modelProfileVersions: [],
      toolVersions: [],
    };
    const index = buildBuilderCatalogIndex(catalog);
    const unknownMpv = "mpv-nope" as ModelProfileVersionId;
    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "w", name: "W" },
      agents: [
        {
          ...minimalNewAgent("bpr_u"),
          model: {
            bindingName: "default",
            modelProfileVersionId: unknownMpv,
          },
        },
      ],
      workflow: {
        nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_u" }],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const r = validateProposalResourcePromptVisibility(
      proposal,
      emptyPromptVisible(),
      index,
    );
    expect(r.ok).toBe(true);
  });
});
