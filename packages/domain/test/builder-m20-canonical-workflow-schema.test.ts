/**
 * M20.1 canonical workflow parity with contracts `workflowDefinitionV3Schema`.
 * `@osva-ai/contracts/schemas` is disallowed in production domain sources; this test-only file disables that rule locally.
 */
/* eslint-disable no-restricted-imports */
import type {
  AgentId,
  AgentVersionId,
  ConnectorVersionId,
  ModelProfileId,
  ModelProfileVersionId,
  ToolId,
  ToolVersionId,
} from "@osva-ai/contracts";
import { MCP_TOOL_IMPLEMENTATION } from "@osva-ai/contracts";
import { workflowDefinitionV3Schema } from "@osva-ai/contracts/schemas";
import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { AgentVersion } from "../src/agent-version.js";
import {
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
  compileBuilderProposalResolved,
  compileDeclarativeManifestFromNewAgent,
  type BuilderProposalV1,
} from "../src/builder/index.js";
import { GetWorkspaceBuilderCapabilityCatalog } from "../src/builder/workspace-builder-capability-catalog.js";
import { ModelProfile } from "../src/model-profile.js";
import { ModelProfileVersion } from "../src/model-profile-version.js";
import { Tool } from "../src/tool.js";
import { ToolVersion } from "../src/tool-version.js";
import { Workspace } from "../src/workspace.js";
import { assertWorkflowDefinition } from "../src/workflow-definition.js";
import {
  MapAgentRepository,
  MapModelProfileRepository,
  MapToolRepository,
  MapWorkspaceRepository,
} from "./builder-natural-language-test-helpers.js";
import { fakeControlPlaneScope } from "./control-plane-test-scope.js";
import { NOW, workspaceId } from "./fixtures.js";

const ws = workspaceId;

describe("M20.1 canonical workflow + workflowDefinitionV3Schema", () => {
  it("research / parallel / approval / report: assertWorkflowDefinition + zod parity", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const tools = new MapToolRepository();
    const agents = new MapAgentRepository();

    const mp = ModelProfile.create({
      id: "mp-r" as ModelProfileId,
      workspaceId: workspace.id,
      key: "mp",
      name: "MP",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const mpv = ModelProfileVersion.create({
      id: "mpv-r" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt-research",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(mpv);

    const toolEntity = Tool.create({
      id: "tool-r" as ToolId,
      workspaceId: workspace.id,
      key: "web",
      name: "Web",
      createdAt: NOW,
    });
    await tools.saveTool(toolEntity);
    const tv = ToolVersion.create({
      id: "tv-r" as ToolVersionId,
      toolId: toolEntity.id,
      version: 1,
      type: "MCP",
      implementation: MCP_TOOL_IMPLEMENTATION,
      mcp: {
        connectorVersionId: "conn-r" as ConnectorVersionId,
        remoteToolName: "search",
        description: "search",
        inputSchema: {},
      },
      createdAt: NOW,
    });
    await tools.saveToolVersion(tv);

    const catalog = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));

    const index = buildBuilderCatalogIndex(catalog);

    const researcherTools = [{ bindingName: "web", toolVersionId: tv.id }];

    const proposal: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: {
        key: "research_pipeline",
        name: "Research Pipeline",
      },
      agents: [
        {
          kind: "NEW",
          ref: "bpr_research",
          agentKey: "research_agent",
          agentName: "Research Agent",
          instructions: "Plan and delegate parallel analyst work.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: researcherTools,
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 4,
          },
        },
        {
          kind: "NEW",
          ref: "bpr_market",
          agentKey: "market_analyst",
          agentName: "Market Analyst",
          instructions: "Market analysis.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: researcherTools,
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 4,
          },
        },
        {
          kind: "NEW",
          ref: "bpr_risk",
          agentKey: "risk_analyst",
          agentName: "Risk Analyst",
          instructions: "Risk analysis.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: [],
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 0,
          },
        },
        {
          kind: "NEW",
          ref: "bpr_tech",
          agentKey: "technical_analyst",
          agentName: "Technical Analyst",
          instructions: "Technical analysis.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: [],
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 0,
          },
        },
        {
          kind: "NEW",
          ref: "bpr_report",
          agentKey: "report_agent",
          agentName: "Report Agent",
          instructions: "Synthesize final report after approval.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: {
            bindingName: "default",
            modelProfileVersionId: mpv.id as ModelProfileVersionId,
          },
          tools: [],
          execution: {
            timeoutMs: 60_000,
            maxAttempts: 2,
            maxModelInvocations: 8,
            maxToolInvocations: 0,
          },
        },
      ],
      workflow: {
        nodes: [
          { key: "research", type: "AGENT", agentRef: "bpr_research" },
          { key: "parallel", type: "PARALLEL" },
          { key: "market", type: "AGENT", agentRef: "bpr_market" },
          { key: "risk", type: "AGENT", agentRef: "bpr_risk" },
          { key: "technical", type: "AGENT", agentRef: "bpr_tech" },
          { key: "join", type: "JOIN" },
          {
            key: "approval",
            type: "APPROVAL",
            title: "Approve analyst synthesis",
          },
          { key: "report", type: "AGENT", agentRef: "bpr_report" },
        ],
        edges: [
          { from: "research", to: "parallel" },
          { from: "parallel", to: "market" },
          { from: "parallel", to: "risk" },
          { from: "parallel", to: "technical" },
          { from: "market", to: "join" },
          { from: "risk", to: "join" },
          { from: "technical", to: "join" },
          { from: "join", to: "approval" },
          { from: "approval", to: "report" },
        ],
      },
      assumptions: ["Fixture uses catalog-backed model and tool IDs."],
      unresolvedRequirements: [],
    };

    const pre = compileBuilderProposalPrePublication(proposal, index);
    expect(pre.ok).toBe(true);

    const publishManifest = (ref: `bpr_${string}`) => {
      const spec = proposal.agents.find(
        (a) => a.kind === "NEW" && a.ref === ref,
      );
      if (spec === undefined || spec.kind !== "NEW") {
        throw new Error("missing spec");
      }
      return compileDeclarativeManifestFromNewAgent(spec);
    };

    const agentEntities = [
      { key: "research_agent", ref: "bpr_research" as const },
      { key: "market_analyst", ref: "bpr_market" as const },
      { key: "risk_analyst", ref: "bpr_risk" as const },
      { key: "technical_analyst", ref: "bpr_tech" as const },
      { key: "report_agent", ref: "bpr_report" as const },
    ] as const;

    const resolution = new Map<`bpr_${string}`, AgentVersionId>();
    let seq = 0;
    for (const { key, ref } of agentEntities) {
      seq += 1;
      const ag = Agent.create({
        id: `fixture-agent-${String(seq)}` as AgentId,
        workspaceId: workspace.id,
        key,
        name: key,
        createdAt: NOW,
      });
      await agents.saveAgent(ag);
      const manifest = publishManifest(ref);
      const av = AgentVersion.create({
        id: `fixture-av-${String(seq)}` as AgentVersionId,
        agentId: ag.id,
        version: 1,
        manifest,
        createdAt: NOW,
      });
      await agents.saveAgentVersion(av);
      resolution.set(ref, av.id);
    }

    const catalog2 = await new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: new MapWorkspaceRepository(workspace),
      agents,
      modelProfiles,
      tools,
    }).execute(fakeControlPlaneScope(ws));

    const index2 = buildBuilderCatalogIndex(catalog2);

    const resolved = compileBuilderProposalResolved(
      proposal,
      index2,
      resolution,
    );
    expect(resolved.ok).toBe(true);
    assertWorkflowDefinition(resolved.workflowDefinition!);
    expect(
      workflowDefinitionV3Schema.safeParse(resolved.workflowDefinition).success,
    ).toBe(true);
  });
});
