import type { ModelProfileVersionId } from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  buildBuilderCatalogIndex,
  buildBuilderCompileFailureRepairHint,
  compileBuilderProposalPrePublication,
  validateBuilderProposalModelOutputPipeline,
  type BuilderProposalV1,
} from "../src/builder/index.js";
import { GenerateBuilderProposalFromNaturalLanguage } from "../src/builder/generate-builder-proposal-from-natural-language.js";
import type { GenerateCompletionResult } from "@osva-ai/contracts";
import type { BuilderGenerationModelGatewayPort } from "../src/builder/builder-natural-language-generation-types.js";

import { GetWorkspaceBuilderCapabilityCatalog } from "../src/builder/workspace-builder-capability-catalog.js";
import { fakeControlPlaneScope } from "./control-plane-test-scope.js";
import { NOW, workspaceId } from "./fixtures.js";
import {
  MapAgentRepository,
  MapModelProfileRepository,
  MapToolRepository,
  MapWorkspaceRepository,
  baseProposal,
  minimalNewAgent,
} from "./builder-natural-language-test-helpers.js";
import { ModelProfile } from "../src/model-profile.js";
import { ModelProfileVersion } from "../src/model-profile-version.js";
import { Workspace } from "../src/workspace.js";
import type { ToolVersionId } from "@osva-ai/contracts";

const ws = workspaceId;

async function testCatalog(): Promise<{
  index: ReturnType<typeof buildBuilderCatalogIndex>;
  mpvId: ModelProfileVersionId;
}> {
  const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
  const modelProfiles = new MapModelProfileRepository();
  const mp = ModelProfile.create({
    id: "mp-topo" as never,
    workspaceId: ws,
    key: "mp",
    name: "MP",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfile(mp);
  const mpv = ModelProfileVersion.create({
    id: "mpv-topo" as ModelProfileVersionId,
    modelProfileId: mp.id,
    version: 1,
    provider: "OPENAI",
    model: "gpt",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfileVersion(mpv);
  const catalog = await new GetWorkspaceBuilderCapabilityCatalog({
    workspaces: new MapWorkspaceRepository(workspace),
    agents: new MapAgentRepository(),
    modelProfiles,
    tools: new MapToolRepository(),
  }).execute(fakeControlPlaneScope(ws));
  return { index: buildBuilderCatalogIndex(catalog), mpvId: mpv.id };
}

function agent(mpvId: ModelProfileVersionId, ref: `bpr_${string}`) {
  return {
    ...minimalNewAgent(ref),
    model: { bindingName: "default", modelProfileVersionId: mpvId },
  };
}

describe("builder workflow topology hardening (compiler fixtures)", () => {
  it("1–2: valid single AGENT and two sequential AGENT nodes", async () => {
    const { index, mpvId } = await testCatalog();
    expect(
      compileBuilderProposalPrePublication(
        baseProposal({
          agents: [agent(mpvId, "bpr_a")],
        }),
        index,
      ).ok,
    ).toBe(true);

    const two: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_a"), agent(mpvId, "bpr_b")],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_a" },
          { key: "b", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };
    expect(compileBuilderProposalPrePublication(two, index).ok).toBe(true);
  });

  it("3–4: JOIN with one vs two incoming edges", async () => {
    const { index, mpvId } = await testCatalog();
    const loneJoin: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_a"), agent(mpvId, "bpr_b")],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_a" },
          { key: "j", type: "JOIN" },
          { key: "b", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [
          { from: "a", to: "j" },
          { from: "j", to: "b" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };
    const bad = compileBuilderProposalPrePublication(loneJoin, index);
    expect(bad.ok).toBe(false);
    expect(
      bad.issues.some(
        (i) =>
          i.code === "INVALID_GRAPH_TOPOLOGY" &&
          i.message.includes("JOIN") &&
          i.message.includes("incoming"),
      ),
    ).toBe(true);

    const validJoin: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        agent(mpvId, "bpr_s"),
        agent(mpvId, "bpr_1"),
        agent(mpvId, "bpr_2"),
        agent(mpvId, "bpr_out"),
      ],
      workflow: {
        nodes: [
          { key: "s", type: "AGENT", agentRef: "bpr_s" },
          { key: "p", type: "PARALLEL" },
          { key: "b1", type: "AGENT", agentRef: "bpr_1" },
          { key: "b2", type: "AGENT", agentRef: "bpr_2" },
          { key: "j", type: "JOIN" },
          { key: "out", type: "AGENT", agentRef: "bpr_out" },
        ],
        edges: [
          { from: "s", to: "p" },
          { from: "p", to: "b1" },
          { from: "p", to: "b2" },
          { from: "b1", to: "j" },
          { from: "b2", to: "j" },
          { from: "j", to: "out" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };
    expect(compileBuilderProposalPrePublication(validJoin, index).ok).toBe(
      true,
    );
  });

  it("5–6: multiple terminals and zero terminals", async () => {
    const { index, mpvId } = await testCatalog();
    const multiTerminal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_a"), agent(mpvId, "bpr_b")],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_a" },
          { key: "b", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };
    const r = compileBuilderProposalPrePublication(multiTerminal, index);
    expect(r.ok).toBe(false);
    expect(
      r.issues.some(
        (i) =>
          i.code === "INVALID_GRAPH_TOPOLOGY" &&
          (i.message.includes("terminal node") ||
            i.message.includes("entry node")),
      ),
    ).toBe(true);

    const zeroTerminal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_a")],
      workflow: {
        nodes: [{ key: "a", type: "AGENT", agentRef: "bpr_a" }],
        edges: [{ from: "a", to: "a" }],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };
    const z = compileBuilderProposalPrePublication(zeroTerminal, index);
    expect(z.ok).toBe(false);
  });

  it("7: disconnected graph rejected", async () => {
    const { index, mpvId } = await testCatalog();
    const disconnected: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_a"), agent(mpvId, "bpr_b")],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_a" },
          { key: "b", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };
    const r = compileBuilderProposalPrePublication(disconnected, index);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "INVALID_GRAPH_TOPOLOGY")).toBe(
      true,
    );
  });

  it("compile repair hint lists full invariant checklist", async () => {
    const { index, mpvId } = await testCatalog();
    const badJoin: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_a"), agent(mpvId, "bpr_b")],
      workflow: {
        nodes: [
          { key: "themes", type: "AGENT", agentRef: "bpr_a" },
          { key: "identify_themes", type: "JOIN" },
          { key: "out", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [
          { from: "themes", to: "identify_themes" },
          { from: "identify_themes", to: "out" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };
    const compiled = compileBuilderProposalPrePublication(badJoin, index);
    const hint = buildBuilderCompileFailureRepairHint(compiled.issues);
    expect(hint).toContain("Exactly one entry node and one terminal node");
    expect(hint).toContain("JOIN requires at least two incoming");
    const pipeline = validateBuilderProposalModelOutputPipeline(
      JSON.stringify(badJoin),
      index,
      {
        agentVersionIds: new Set(),
        modelProfileVersionIds: new Set([mpvId]),
        toolVersionIds: new Set<ToolVersionId>(),
      },
    );
    expect(pipeline.kind).toBe("hard_fail");
    if (pipeline.kind === "hard_fail") {
      expect(pipeline.repairHint).toContain("full BuilderProposalV1");
    }
  });
});

describe("builder topology repair via mocked gateway", () => {
  it("first invalid JOIN, repair fixes topology to valid two-agent chain", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const mp = ModelProfile.create({
      id: "mp-g" as never,
      workspaceId: ws,
      key: "g",
      name: "G",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const genMpv = ModelProfileVersion.create({
      id: "mpv-gen" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt",
      createdAt: NOW,
    });
    const execMpv = ModelProfileVersion.create({
      id: "mpv-exec" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 2,
      provider: "OPENAI",
      model: "gpt",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(genMpv);
    await modelProfiles.saveModelProfileVersion(execMpv);

    const badJoin = (mpvId: ModelProfileVersionId): BuilderProposalV1 => ({
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_sum"), agent(mpvId, "bpr_out")],
      workflow: {
        nodes: [
          { key: "sum", type: "AGENT", agentRef: "bpr_sum" },
          { key: "identify_themes", type: "JOIN" },
          { key: "out", type: "AGENT", agentRef: "bpr_out" },
        ],
        edges: [
          { from: "sum", to: "identify_themes" },
          { from: "identify_themes", to: "out" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    });

    const fixed: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(execMpv.id, "bpr_sum"), agent(execMpv.id, "bpr_out")],
      workflow: {
        nodes: [
          { key: "sum", type: "AGENT", agentRef: "bpr_sum" },
          { key: "out", type: "AGENT", agentRef: "bpr_out" },
        ],
        edges: [{ from: "sum", to: "out" }],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    let calls = 0;
    const gateway: BuilderGenerationModelGatewayPort = {
      generateCompletion: vi.fn(async () => {
        calls += 1;
        const body = calls === 1 ? badJoin(execMpv.id) : fixed;
        return {
          text: JSON.stringify(body),
          toolCalls: [],
          finishReason: "stop",
        } satisfies GenerateCompletionResult;
      }),
    };

    const svc = new GenerateBuilderProposalFromNaturalLanguage({
      workspaces: new MapWorkspaceRepository(workspace),
      agents: new MapAgentRepository(),
      modelProfiles,
      tools: new MapToolRepository(),
      modelGateway: gateway,
      limits: { maxProviderInvocations: 2 },
    });

    const r = await svc.execute({
      scope: fakeControlPlaneScope(ws),
      userInstruction: "Summarize feedback with themes then recommendations.",
      generationModelProfileVersionId: genMpv.id,
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    if (!r.ok) {
      expect(r.metadata).toBeDefined();
      expect(r.metadata?.attemptDiagnostics?.[0]?.compileIssues?.[0]?.code).toBe(
        "INVALID_GRAPH_TOPOLOGY",
      );
    }
  });

  it("repair fixes JOIN but leaves multiple terminals — still fails with diagnostics", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const mp = ModelProfile.create({
      id: "mp-g2" as never,
      workspaceId: ws,
      key: "g2",
      name: "G2",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const genMpv = ModelProfileVersion.create({
      id: "mpv-gen2" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt",
      createdAt: NOW,
    });
    const execMpv = ModelProfileVersion.create({
      id: "mpv-exec2" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 2,
      provider: "OPENAI",
      model: "gpt",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(genMpv);
    await modelProfiles.saveModelProfileVersion(execMpv);

    const badJoin = (mpvId: ModelProfileVersionId): BuilderProposalV1 => ({
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [
        agent(mpvId, "bpr_a"),
        agent(mpvId, "bpr_b"),
        agent(mpvId, "bpr_c"),
      ],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_a" },
          { key: "j", type: "JOIN" },
          { key: "b", type: "AGENT", agentRef: "bpr_b" },
          { key: "c", type: "AGENT", agentRef: "bpr_c" },
        ],
        edges: [
          { from: "a", to: "j" },
          { from: "j", to: "b" },
          { from: "j", to: "c" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    });

    const stillBad: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(execMpv.id, "bpr_a"), agent(execMpv.id, "bpr_b")],
      workflow: {
        nodes: [
          { key: "a", type: "AGENT", agentRef: "bpr_a" },
          { key: "b", type: "AGENT", agentRef: "bpr_b" },
        ],
        edges: [],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    let calls = 0;
    const gateway: BuilderGenerationModelGatewayPort = {
      generateCompletion: vi.fn(async () => {
        calls += 1;
        const body = calls === 1 ? badJoin(execMpv.id) : stillBad;
        return {
          text: JSON.stringify(body),
          toolCalls: [],
          finishReason: "stop",
        } satisfies GenerateCompletionResult;
      }),
    };

    const svc = new GenerateBuilderProposalFromNaturalLanguage({
      workspaces: new MapWorkspaceRepository(workspace),
      agents: new MapAgentRepository(),
      modelProfiles,
      tools: new MapToolRepository(),
      modelGateway: gateway,
      limits: { maxProviderInvocations: 2 },
    });

    const r = await svc.execute({
      scope: fakeControlPlaneScope(ws),
      userInstruction: "x",
      generationModelProfileVersionId: genMpv.id,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.metadata).toBeDefined();
      const metadata = r.metadata!;
      expect(metadata.attempts).toBe(2);
      expect(metadata.attemptDiagnostics).toHaveLength(2);
      expect(metadata.attemptDiagnostics?.[1]?.errorCode).toBe(
        "INVALID_COMPILED_PROPOSAL",
      );
      expect(metadata.attemptDiagnostics?.[1]?.compileIssues?.[0]?.code).toBe(
        "INVALID_GRAPH_TOPOLOGY",
      );
    }
  });
});
