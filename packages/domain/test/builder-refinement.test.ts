import type {
  ModelProfileId,
  ModelProfileVersionId,
  ToolId,
  ToolVersionId,
} from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  compareBuilderProposalChanges,
  computeBuilderProposalDigest,
} from "../src/builder/index.js";
import type { BuilderProposalV1 } from "../src/builder/builder-proposal.js";
import { RefineBuilderProposalFromNaturalLanguage } from "../src/builder/refine-builder-proposal-from-natural-language.js";
import { ModelProfile } from "../src/model-profile.js";
import { ModelProfileVersion } from "../src/model-profile-version.js";
import { Tool } from "../src/tool.js";
import { ToolVersion } from "../src/tool-version.js";
import { Workspace } from "../src/workspace.js";
import { fakeControlPlaneScope } from "./control-plane-test-scope.js";
import {
  baseProposal,
  MapAgentRepository,
  MapModelProfileRepository,
  MapToolRepository,
  MapWorkspaceRepository,
  minimalNewAgent,
} from "./builder-natural-language-test-helpers.js";
import { NOW, workspaceId } from "./fixtures.js";

const ws = workspaceId;

async function seedRefinementDeps() {
  const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
  const modelProfiles = new MapModelProfileRepository();
  const tools = new MapToolRepository();
  const agents = new MapAgentRepository();

  const mp = ModelProfile.create({
    id: "mp-test" as ModelProfileId,
    workspaceId: ws,
    key: "mp",
    name: "Test Profile",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfile(mp);
  const genMpv = ModelProfileVersion.create({
    id: "mpv-gen" as ModelProfileVersionId,
    modelProfileId: mp.id,
    version: 1,
    provider: "OPENAI",
    model: "gpt-test",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfileVersion(genMpv);
  const execMpv = ModelProfileVersion.create({
    id: "mpv-test" as ModelProfileVersionId,
    modelProfileId: mp.id,
    version: 2,
    provider: "OPENAI",
    model: "gpt-test",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfileVersion(execMpv);

  const toolEntity = Tool.create({
    id: "tool-1" as ToolId,
    workspaceId: ws,
    key: "noop",
    name: "Noop",
    createdAt: NOW,
  });
  await tools.saveTool(toolEntity);
  const tv = ToolVersion.create({
    id: "tv-test" as ToolVersionId,
    toolId: toolEntity.id,
    version: 1,
    type: "INTERNAL",
    implementation: "OSVA_ECHO_V1",
    createdAt: NOW,
  });
  await tools.saveToolVersion(tv);

  return {
    deps: {
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    },
    genMpv,
  };
}

describe("M20.5 builder refinement", () => {
  it("compareBuilderProposalChanges detects agent addition", () => {
    const before = baseProposal();
    const extra = minimalNewAgent("bpr_b");
    const after: BuilderProposalV1 = {
      ...before,
      agents: [...before.agents, extra],
      workflow: {
        nodes: [
          ...before.workflow.nodes,
          { key: "n2", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [{ from: "n1", to: "n2" }],
      },
    };
    const changes = compareBuilderProposalChanges(before, after);
    expect(changes.addedAgents.map((a) => a.ref)).toEqual(["bpr_b"]);
    expect(changes.noop).toBe(false);
  });

  it("compareBuilderProposalChanges is noop for identical proposals", () => {
    const p = baseProposal();
    const changes = compareBuilderProposalChanges(p, p);
    expect(changes.noop).toBe(true);
  });

  it("rejects stale base digest without model call", async () => {
    const { deps, genMpv } = await seedRefinementDeps();
    const gateway = vi.fn();
    const svc = new RefineBuilderProposalFromNaturalLanguage({
      ...deps,
      modelGateway: { generateCompletion: gateway },
    });
    const proposal = baseProposal();
    const r = await svc.execute({
      scope: fakeControlPlaneScope(ws),
      currentProposal: proposal,
      refinementInstruction: "Add an agent.",
      generationModelProfileVersionId: genMpv.id,
      expectedBaseProposalDigest: "sha256:wrong",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe("STALE_BASE_PROPOSAL_DIGEST");
    }
    expect(gateway).not.toHaveBeenCalled();
  });

  it("successful refinement returns changeset from server validation", async () => {
    const { deps, genMpv } = await seedRefinementDeps();
    const before = baseProposal();
    const after: BuilderProposalV1 = {
      ...before,
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          model: {
            ...minimalNewAgent("bpr_a").model,
            modelProfileVersionId: genMpv.id,
          },
          instructions: "Updated instructions.",
        },
      ],
    };
    const svc = new RefineBuilderProposalFromNaturalLanguage({
      ...deps,
      modelGateway: {
        generateCompletion: async () => ({
          text: JSON.stringify(after),
          toolCalls: [],
          finishReason: "stop",
        }),
      },
    });
    const baseDigest = computeBuilderProposalDigest(before);
    const r = await svc.execute({
      scope: fakeControlPlaneScope(ws),
      currentProposal: before,
      refinementInstruction: "Tighten instructions.",
      generationModelProfileVersionId: genMpv.id,
      expectedBaseProposalDigest: baseDigest,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changes.modifiedAgents.some((m) => m.ref === "bpr_a")).toBe(
        true,
      );
      expect(r.candidateProposalDigest).toBe(
        computeBuilderProposalDigest(after),
      );
    }
  });
});
