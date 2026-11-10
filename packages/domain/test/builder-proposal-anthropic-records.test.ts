import type {
  AgentVersionId,
  ModelProfileVersionId,
  ToolVersionId,
} from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  ANTHROPIC_RECORDS_ENCODING,
  BuilderProposalAnthropicRecordsJsonSchema,
  BuilderProposalOpenAiJsonSchema,
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
  computeBuilderProposalDigest,
  decodeBuilderProposalProviderOutput,
  encodeBuilderProposalAsAnthropicRecords,
  jsonSchemaForBuilderProvider,
  parseBuilderProposalV1,
  validateBuilderProposalModelOutputPipeline,
  type BuilderProposalV1,
} from "../src/builder/index.js";
import { GenerateBuilderProposalFromNaturalLanguage } from "../src/builder/generate-builder-proposal-from-natural-language.js";
import { RefineBuilderProposalFromNaturalLanguage } from "../src/builder/refine-builder-proposal-from-natural-language.js";
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

const ws = workspaceId;
const PROBE_OUTPUT_TOKEN_BUDGET = 2048;

async function testCatalog(): Promise<{
  index: ReturnType<typeof buildBuilderCatalogIndex>;
  mpvId: ModelProfileVersionId;
}> {
  const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
  const modelProfiles = new MapModelProfileRepository();
  const mp = ModelProfile.create({
    id: "mp-records" as never,
    workspaceId: ws,
    key: "mp",
    name: "MP",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfile(mp);
  const mpv = ModelProfileVersion.create({
    id: "mpv-records" as ModelProfileVersionId,
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

function emptyPromptVisible() {
  return {
    agentVersionIds: new Set<AgentVersionId>(),
    modelProfileVersionIds: new Set<ModelProfileVersionId>(),
    toolVersionIds: new Set<ToolVersionId>(),
  };
}

function catalogPromptVisible(mpvId: ModelProfileVersionId) {
  return {
    agentVersionIds: new Set<AgentVersionId>(),
    modelProfileVersionIds: new Set<ModelProfileVersionId>([mpvId]),
    toolVersionIds: new Set<ToolVersionId>(),
  };
}

function pipelineText(
  value: unknown,
  index: ReturnType<typeof buildBuilderCatalogIndex>,
  mpvId?: ModelProfileVersionId,
) {
  return validateBuilderProposalModelOutputPipeline(
    JSON.stringify(value),
    index,
    mpvId === undefined ? emptyPromptVisible() : catalogPromptVisible(mpvId),
  );
}

function recordList(encoded: Record<string, unknown>) {
  return encoded.records as Array<Record<string, unknown>>;
}

function estimateOutputTokens(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}

function fullGraph(mpvId: ModelProfileVersionId): BuilderProposalV1 {
  return {
    schemaVersion: "1",
    workflowRegistry: {
      key: "wf",
      name: "WF",
      description: "weekly summary",
    },
    agents: [agent(mpvId, "bpr_a")],
    workflow: {
      nodes: [
        { key: "start", type: "AGENT", agentRef: "bpr_a" },
        {
          key: "split",
          type: "BRANCH",
          selector: "/severity",
          cases: [
            { equals: "high", to: "par" },
            { equals: 1, to: "wait_d" },
            { equals: true, to: "wait_d" },
            { equals: null, to: "wait_d" },
          ],
          defaultTo: "wait_d",
        },
        { key: "par", type: "PARALLEL" },
        { key: "left", type: "AGENT", agentRef: "bpr_a" },
        { key: "right", type: "AGENT", agentRef: "bpr_a" },
        { key: "join", type: "JOIN" },
        { key: "approve", type: "APPROVAL", title: "Review" },
        {
          key: "wait_d",
          type: "WAIT",
          wait: { kind: "DURATION", durationMs: 1000 },
        },
        {
          key: "wait_u",
          type: "WAIT",
          wait: { kind: "UNTIL", until: "2026-11-10T00:00:00.000Z" },
        },
        {
          key: "wait_e",
          type: "WAIT",
          wait: {
            kind: "EVENT",
            source: "tickets",
            eventType: "closed",
            correlation: { kind: "LITERAL", value: "abc" },
            timeoutMs: 5000,
          },
        },
        {
          key: "wait_p",
          type: "WAIT",
          wait: {
            kind: "EVENT",
            source: "tickets",
            eventType: "closed",
            correlation: { kind: "INPUT_POINTER", pointer: "/id" },
          },
        },
      ],
      edges: [
        { from: "start", to: "split" },
        { from: "split", to: "par" },
        { from: "split", to: "wait_d" },
        { from: "par", to: "left" },
        { from: "par", to: "right" },
        { from: "left", to: "join" },
        { from: "right", to: "join" },
        { from: "wait_d", to: "wait_u" },
        { from: "wait_u", to: "wait_e" },
        { from: "wait_e", to: "wait_p" },
        { from: "wait_p", to: "join" },
        { from: "join", to: "approve" },
      ],
    },
    assumptions: ["humans review high severity"],
    unresolvedRequirements: [],
  };
}

describe("Anthropic records builder IR", () => {
  it("keeps OpenAI and Gemini on the canonical schema", () => {
    expect(jsonSchemaForBuilderProvider("OPENAI")).toBe(
      BuilderProposalOpenAiJsonSchema,
    );
    expect(jsonSchemaForBuilderProvider("GOOGLE_GEMINI")).toBe(
      BuilderProposalOpenAiJsonSchema,
    );
    expect(jsonSchemaForBuilderProvider("ANTHROPIC")).toBe(
      BuilderProposalAnthropicRecordsJsonSchema,
    );
  });

  it("round-trips AGENT, BRANCH, PARALLEL, JOIN, APPROVAL, and WAIT nodes", async () => {
    const { index, mpvId } = await testCatalog();
    const proposal = fullGraph(mpvId);
    const encoded = encodeBuilderProposalAsAnthropicRecords(proposal);
    expect(encoded.encoding).toBe(ANTHROPIC_RECORDS_ENCODING);
    const decoded = decodeBuilderProposalProviderOutput(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    const parsed = parseBuilderProposalV1(decoded.proposal);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.proposal).toEqual(proposal);
    const compiled = compileBuilderProposalPrePublication(
      parsed.proposal,
      index,
    );
    expect(compiled.ok).toBe(true);
  });

  it("fails closed on extra keys, missing records, unknown encoding, and unknown kinds", () => {
    expect(
      decodeBuilderProposalProviderOutput({
        encoding: "anthropic_compact_v1",
        records: [],
      }).ok,
    ).toBe(false);
    expect(
      decodeBuilderProposalProviderOutput({
        encoding: ANTHROPIC_RECORDS_ENCODING,
        extra: true,
        records: [],
      }).ok,
    ).toBe(false);
    expect(
      decodeBuilderProposalProviderOutput({
        encoding: ANTHROPIC_RECORDS_ENCODING,
      }).ok,
    ).toBe(false);

    const encoded = encodeBuilderProposalAsAnthropicRecords(baseProposal());
    const records = recordList(encoded);
    records.push({ ...records[0]!, kind: "mystery" });
    const unknownKind = decodeBuilderProposalProviderOutput(encoded);
    expect(unknownKind.ok).toBe(false);
    if (!unknownKind.ok) {
      expect(unknownKind.messages.join(" ")).toMatch(/unknown record kind/);
    }
  });

  it("rejects duplicate fields, missing WAIT configuration, and populated unused fields", () => {
    const encoded = encodeBuilderProposalAsAnthropicRecords(baseProposal());
    const records = recordList(encoded);
    records.push({ ...records[0]! });
    const duplicateMeta = decodeBuilderProposalProviderOutput(encoded);
    expect(duplicateMeta.ok).toBe(false);
    if (!duplicateMeta.ok) {
      expect(duplicateMeta.messages.join(" ")).toMatch(/duplicate meta/);
    }

    const waitMissing = encodeBuilderProposalAsAnthropicRecords(baseProposal());
    recordList(waitMissing).push({
      kind: "node",
      id: "wait",
      role: "WAIT_DURATION",
      name: "",
      label: "",
      text: "",
      ref: "",
      ref2: "",
      n1: 0,
      n2: 0,
      n3: 0,
      n4: 0,
      n5: 0,
      flag: "",
      flag2: "",
      ord: 1,
    });
    const decodedWait = decodeBuilderProposalProviderOutput(waitMissing);
    expect(decodedWait.ok).toBe(false);
    if (!decodedWait.ok) {
      expect(decodedWait.messages.join(" ")).toMatch(/durationMs/);
    }

    const unused = encodeBuilderProposalAsAnthropicRecords(baseProposal());
    const agentNode = recordList(unused).find((row) => row.role === "AGENT");
    expect(agentNode).toBeDefined();
    if (agentNode !== undefined) {
      agentNode.name = "smuggled";
    }
    const decodedUnused = decodeBuilderProposalProviderOutput(unused);
    expect(decodedUnused.ok).toBe(false);
    if (!decodedUnused.ok) {
      expect(decodedUnused.messages.join(" ")).toMatch(/unused fields/);
    }
  });

  it("rejects invalid graph references after canonical compile", async () => {
    const { index, mpvId } = await testCatalog();
    const proposal = baseProposal({
      agents: [agent(mpvId, "bpr_a")],
      workflow: {
        nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_a" }],
        edges: [{ from: "n1", to: "missing" }],
      },
    });
    const encoded = encodeBuilderProposalAsAnthropicRecords(proposal);
    const result = pipelineText(encoded, index, mpvId);
    expect(result.kind).toBe("hard_fail");
    if (result.kind === "hard_fail") {
      expect(result.failure.errorCode).toBe("INVALID_COMPILED_PROPOSAL");
    }
  });

  it("rejects malformed JSON and invalid record field types", async () => {
    const { index } = await testCatalog();
    const malformed = validateBuilderProposalModelOutputPipeline(
      "{",
      index,
      emptyPromptVisible(),
    );
    expect(malformed.kind).toBe("hard_fail");
    if (malformed.kind === "hard_fail") {
      expect(malformed.failure.errorCode).toBe("INVALID_JSON_OUTPUT");
    }

    const encoded = encodeBuilderProposalAsAnthropicRecords(baseProposal());
    const node = recordList(encoded).find((row) => row.role === "AGENT");
    if (node !== undefined) {
      node.ref = "not-a-ref";
    }
    const invalidRef = pipelineText(encoded, index);
    expect(invalidRef.kind).toBe("hard_fail");
    if (invalidRef.kind === "hard_fail") {
      expect(invalidRef.failure.errorCode).toBe("INVALID_BUILDER_PROPOSAL");
    }
  });

  it("does not turn unauthorized tool ids into a valid workflow", async () => {
    const { index, mpvId } = await testCatalog();
    const proposal = baseProposal({
      agents: [
        {
          ...agent(mpvId, "bpr_a"),
          tools: [
            {
              bindingName: "search",
              toolVersionId: "tv-nope" as never,
            },
          ],
        },
      ],
    });
    const encoded = encodeBuilderProposalAsAnthropicRecords(proposal);
    const result = pipelineText(encoded, index, mpvId);
    expect(result.kind).toBe("hard_fail");
    if (result.kind === "hard_fail") {
      expect(result.failure.errorCode).toBe(
        "UNAUTHORIZED_OR_UNKNOWN_RESOURCE_REFERENCE",
      );
    }
  });

  it("does not turn a missing records array into a valid workflow", async () => {
    const { index, mpvId } = await testCatalog();
    const encoded = encodeBuilderProposalAsAnthropicRecords(
      baseProposal({ agents: [agent(mpvId, "bpr_a")] }),
    );
    delete encoded.records;
    const decoded = decodeBuilderProposalProviderOutput(encoded);
    expect(decoded.ok).toBe(false);
    const pipeline = pipelineText(encoded, index);
    expect(pipeline.kind).toBe("hard_fail");
  });

  it("keeps fixture output estimates under the 2048-token probe budget", async () => {
    const { mpvId } = await testCatalog();
    const oneAgent = encodeBuilderProposalAsAnthropicRecords(
      baseProposal({ agents: [agent(mpvId, "bpr_a")] }),
    );
    const branch: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_a")],
      workflow: {
        nodes: [
          { key: "start", type: "AGENT", agentRef: "bpr_a" },
          {
            key: "split",
            type: "BRANCH",
            selector: "/ok",
            cases: [{ equals: "yes", to: "end" }],
            defaultTo: "end",
          },
          { key: "end", type: "APPROVAL", title: "Done" },
        ],
        edges: [
          { from: "start", to: "split" },
          { from: "split", to: "end" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };
    const parallel: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_a")],
      workflow: {
        nodes: [
          { key: "start", type: "AGENT", agentRef: "bpr_a" },
          { key: "par", type: "PARALLEL" },
          { key: "left", type: "AGENT", agentRef: "bpr_a" },
          { key: "right", type: "AGENT", agentRef: "bpr_a" },
          { key: "join", type: "JOIN" },
        ],
        edges: [
          { from: "start", to: "par" },
          { from: "par", to: "left" },
          { from: "par", to: "right" },
          { from: "left", to: "join" },
          { from: "right", to: "join" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };
    const waitEvent: BuilderProposalV1 = {
      schemaVersion: "1",
      workflowRegistry: { key: "wf", name: "WF" },
      agents: [agent(mpvId, "bpr_a")],
      workflow: {
        nodes: [
          { key: "start", type: "AGENT", agentRef: "bpr_a" },
          {
            key: "wait",
            type: "WAIT",
            wait: { kind: "DURATION", durationMs: 1000 },
          },
          {
            key: "event",
            type: "WAIT",
            wait: {
              kind: "EVENT",
              source: "tickets",
              eventType: "closed",
              correlation: { kind: "LITERAL", value: "abc" },
            },
          },
        ],
        edges: [
          { from: "start", to: "wait" },
          { from: "wait", to: "event" },
        ],
      },
      assumptions: [],
      unresolvedRequirements: [],
    };

    const estimates = {
      oneAgent: estimateOutputTokens(oneAgent),
      branch: estimateOutputTokens(
        encodeBuilderProposalAsAnthropicRecords(branch),
      ),
      parallel: estimateOutputTokens(
        encodeBuilderProposalAsAnthropicRecords(parallel),
      ),
      waitEvent: estimateOutputTokens(
        encodeBuilderProposalAsAnthropicRecords(waitEvent),
      ),
      fullGraph: estimateOutputTokens(
        encodeBuilderProposalAsAnthropicRecords(fullGraph(mpvId)),
      ),
    };
    for (const tokens of Object.values(estimates)) {
      expect(tokens).toBeLessThan(PROBE_OUTPUT_TOKEN_BUDGET);
    }
  });

  it("Anthropic generation sends records schema and accepts records output", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const mp = ModelProfile.create({
      id: "mp-anthropic-gen" as never,
      workspaceId: ws,
      key: "mp",
      name: "MP",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const genMpv = ModelProfileVersion.create({
      id: "mpv-anthropic-live" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "ANTHROPIC",
      model: "claude-sonnet-5-5",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(genMpv);

    const seen: unknown[] = [];
    const systems: string[] = [];
    const gateway: BuilderGenerationModelGatewayPort = {
      generateCompletion: vi.fn(async (request) => {
        seen.push(request.jsonSchema);
        systems.push(request.messages[0]?.content ?? "");
        const result: GenerateCompletionResult = {
          text: JSON.stringify(
            encodeBuilderProposalAsAnthropicRecords(
              baseProposal({
                agents: [agent(genMpv.id, "bpr_a")],
              }),
            ),
          ),
          toolCalls: [],
          finishReason: "stop",
        };
        return result;
      }),
    };

    const svc = new GenerateBuilderProposalFromNaturalLanguage({
      workspaces: new MapWorkspaceRepository(workspace),
      agents: new MapAgentRepository(),
      modelProfiles,
      tools: new MapToolRepository(),
      modelGateway: gateway,
    });
    const r = await svc.execute({
      scope: fakeControlPlaneScope(ws),
      userInstruction: "Create a one-agent workflow.",
      generationModelProfileVersionId: genMpv.id,
    });
    expect(r.ok).toBe(true);
    expect(seen[0]).toBe(BuilderProposalAnthropicRecordsJsonSchema);
    expect(systems[0]).toContain("anthropic_records_v1");
    expect(gateway.generateCompletion).toHaveBeenCalledTimes(1);
  });

  it("Anthropic refinement sends records schema and current proposal as records IR", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const mp = ModelProfile.create({
      id: "mp-anthropic-ref" as never,
      workspaceId: ws,
      key: "mp",
      name: "MP",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const genMpv = ModelProfileVersion.create({
      id: "mpv-anthropic-ref" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "ANTHROPIC",
      model: "claude-sonnet-5-5",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(genMpv);

    const proposal = baseProposal({
      agents: [agent(genMpv.id, "bpr_a")],
    });
    const seen: unknown[] = [];
    const contents: string[] = [];
    const gateway: BuilderGenerationModelGatewayPort = {
      generateCompletion: vi.fn(async (request) => {
        seen.push(request.jsonSchema);
        for (const message of request.messages) {
          contents.push(message.content);
        }
        const result: GenerateCompletionResult = {
          text: JSON.stringify(
            encodeBuilderProposalAsAnthropicRecords(proposal),
          ),
          toolCalls: [],
          finishReason: "stop",
        };
        return result;
      }),
    };

    const svc = new RefineBuilderProposalFromNaturalLanguage({
      workspaces: new MapWorkspaceRepository(workspace),
      agents: new MapAgentRepository(),
      modelProfiles,
      tools: new MapToolRepository(),
      modelGateway: gateway,
    });
    const r = await svc.execute({
      scope: fakeControlPlaneScope(ws),
      currentProposal: proposal,
      refinementInstruction: "Keep the one-agent workflow.",
      generationModelProfileVersionId: genMpv.id,
      expectedBaseProposalDigest: computeBuilderProposalDigest(proposal),
    });
    expect(r.ok).toBe(true);
    expect(seen[0]).toBe(BuilderProposalAnthropicRecordsJsonSchema);
    expect(contents.join("\n")).toContain("anthropic_records_v1");
    expect(gateway.generateCompletion).toHaveBeenCalledTimes(1);
  });

  it("OpenAI generation still sends the canonical Builder schema", async () => {
    const workspace = Workspace.create({ id: ws, name: "W", createdAt: NOW });
    const modelProfiles = new MapModelProfileRepository();
    const mp = ModelProfile.create({
      id: "mp-openai-gen" as never,
      workspaceId: ws,
      key: "mp",
      name: "MP",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(mp);
    const genMpv = ModelProfileVersion.create({
      id: "mpv-openai-live" as ModelProfileVersionId,
      modelProfileId: mp.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt-4o-mini",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfileVersion(genMpv);

    const seen: unknown[] = [];
    const gateway: BuilderGenerationModelGatewayPort = {
      generateCompletion: vi.fn(async (request) => {
        seen.push(request.jsonSchema);
        const result: GenerateCompletionResult = {
          text: JSON.stringify(
            baseProposal({
              agents: [agent(genMpv.id, "bpr_a")],
            }),
          ),
          toolCalls: [],
          finishReason: "stop",
        };
        return result;
      }),
    };

    const svc = new GenerateBuilderProposalFromNaturalLanguage({
      workspaces: new MapWorkspaceRepository(workspace),
      agents: new MapAgentRepository(),
      modelProfiles,
      tools: new MapToolRepository(),
      modelGateway: gateway,
    });
    const r = await svc.execute({
      scope: fakeControlPlaneScope(ws),
      userInstruction: "Create a one-agent workflow.",
      generationModelProfileVersionId: genMpv.id,
    });
    expect(r.ok).toBe(true);
    expect(seen[0]).toBe(BuilderProposalOpenAiJsonSchema);
  });
});
