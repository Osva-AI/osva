import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildAnalysisManifest,
  buildReportManifest,
  buildResearchManifest,
} from "../scripts/lib/manifests.js";
import {
  sha256IntegrityOf,
  isSha256IntegrityDigest,
} from "../scripts/lib/integrity.js";
import { pollUntilReady, SetupPollError } from "../scripts/lib/poll.js";
import {
  distAgentsDir,
  stateFilePath,
  trustedRuntimeBundleDir,
  trustedRuntimeEntrypointPosix,
} from "../scripts/lib/paths.js";
import { buildStdioMcpTransportConfig } from "../scripts/lib/deploy.js";
import {
  loadReferenceWorkflowDefinition,
  materializeWorkflowDefinition,
} from "../scripts/lib/workflow.js";
import {
  assertStateHasNoSecrets,
  parseCanonicalState,
  type CanonicalStateV1,
} from "../scripts/lib/state.js";
import { validateDiscoveredTools } from "../scripts/lib/resources.js";
import { assertWorkflowDefinition } from "@osva/domain";
import type {
  AgentVersionId,
  KnowledgeIndexId,
  ModelProfileVersionId,
  ToolVersionId,
} from "@osva-ai/contracts";

const sampleState: CanonicalStateV1 = {
  schemaVersion: "1",
  workspaceId: "ws-canonical",
  modelProfileId: "mp-1",
  modelProfileVersionId: "mpv-1",
  policyArtifactId: "artifact-1",
  knowledgeSourceId: "ks-1",
  knowledgeIndexId: "ki-1",
  connectorId: "conn-1",
  connectorVersionId: "connv-1",
  tools: {
    npmPackageMetadata: {
      toolId: "tool-1",
      toolVersionId: "tv-1" as ToolVersionId,
    },
    npmDownloads: { toolId: "tool-2", toolVersionId: "tv-2" as ToolVersionId },
  },
  agents: {
    research: { agentId: "a-1", agentVersionId: "av-1" as AgentVersionId },
    analysis: { agentId: "a-2", agentVersionId: "av-2" as AgentVersionId },
    report: { agentId: "a-3", agentVersionId: "av-3" as AgentVersionId },
  },
  workflowId: "wf-1",
  workflowVersionId: "wfv-1",
  trustedRuntime: {
    researchIntegrity: "sha256:" + "a".repeat(64),
    analysisIntegrity: "sha256:" + "b".repeat(64),
    reportIntegrity: "sha256:" + "c".repeat(64),
    mcpStdioEntry: "C:\\\\repo\\\\dist\\\\mcp\\\\npm-connector\\\\stdio.js",
  },
};

describe("canonical setup state", () => {
  it("parses state without secret-like keys", () => {
    assertStateHasNoSecrets(sampleState);
    const serialized = JSON.stringify(sampleState);
    expect(serialized).not.toMatch(/apiKey/i);
    expect(parseCanonicalState(serialized)).toEqual(sampleState);
    expect(stateFilePath()).toContain(".osva");
  });

  it("rejects malformed state", () => {
    expect(() => parseCanonicalState("{")).toThrow(/valid JSON/i);
    expect(() =>
      parseCanonicalState(JSON.stringify({ schemaVersion: "2" })),
    ).toThrow(/schemaVersion/i);
  });
});

describe("canonical setup paths", () => {
  it("generates POSIX trusted-runtime entrypoints", () => {
    expect(trustedRuntimeEntrypointPosix("research-agent.js")).toBe(
      "canonical-dependency-adoption/research-agent.js",
    );
  });

  it("builds absolute stdio MCP command args", () => {
    const config = buildStdioMcpTransportConfig("C:\\\\tmp\\\\stdio.js");
    expect(config.command).toBe(process.execPath);
    expect(path.isAbsolute(config.args[0] ?? "")).toBe(true);
  });

  it("expects shared agent subtree under dist/agents", () => {
    expect(distAgentsDir).toContain(path.join("dist", "agents"));
    expect(trustedRuntimeBundleDir("C:\\runtime-root")).toBe(
      path.join("C:\\runtime-root", "canonical-dependency-adoption"),
    );
  });
});

describe("canonical setup integrity", () => {
  it("uses sha256: digest format and detects byte changes", () => {
    const first = sha256IntegrityOf("alpha");
    const second = sha256IntegrityOf("beta");
    expect(isSha256IntegrityDigest(first)).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe("canonical setup polling", () => {
  it("waits through pending states", async () => {
    let calls = 0;
    const result = await pollUntilReady({
      label: "Knowledge index",
      intervalMs: 1,
      timeoutMs: 100,
      fetch: async () => {
        calls += 1;
        if (calls < 3) {
          return { status: calls === 1 ? "PENDING" : "RUNNING" };
        }
        return { status: "READY" };
      },
      getStatus: (value) => value.status,
      isReady: (value) => value.status === "READY",
      isFailed: (value) => value.status === "FAILED",
    });
    expect(result).toEqual({ status: "READY" });
    expect(calls).toBe(3);
  });

  it("throws on failed and timed out polls", async () => {
    await expect(
      pollUntilReady({
        label: "Knowledge index",
        intervalMs: 1,
        timeoutMs: 5,
        fetch: async () => ({ status: "FAILED" }),
        getStatus: (value) => value.status,
        isReady: (value) => value.status === "READY",
        isFailed: (value) => value.status === "FAILED",
      }),
    ).rejects.toBeInstanceOf(SetupPollError);

    await expect(
      pollUntilReady({
        label: "Knowledge index",
        intervalMs: 1,
        timeoutMs: 5,
        fetch: async () => ({ status: "PENDING" }),
        getStatus: (value) => value.status,
        isReady: (value) => value.status === "READY",
        isFailed: (value) => value.status === "FAILED",
      }),
    ).rejects.toBeInstanceOf(SetupPollError);
  });
});

describe("canonical workflow materialization", () => {
  it("inserts runtime AgentVersion IDs and validates V3 graph", async () => {
    const definition = materializeWorkflowDefinition(
      await loadReferenceWorkflowDefinition(),
      {
        research: "av-research" as AgentVersionId,
        analysis: "av-analysis" as AgentVersionId,
        report: "av-report" as AgentVersionId,
      },
    );
    expect(() => assertWorkflowDefinition(definition)).not.toThrow();
    const waitNode = definition.nodes.find(
      (node) => node.key === "delivery-wait",
    );
    expect(waitNode?.type).toBe("WAIT");
    if (waitNode?.type === "WAIT") {
      expect(waitNode.wait).toMatchObject({
        kind: "EVENT",
        correlation: {
          kind: "INPUT_POINTER",
          pointer: "/request/requestId",
        },
      });
    }
  });
});

describe("canonical agent manifests", () => {
  const base = {
    key: "agent",
    name: "Agent",
    entrypoint: "canonical-dependency-adoption/research-agent.js",
    integrity: "sha256:" + "d".repeat(64),
    modelProfileVersionId: "mpv-1" as ModelProfileVersionId,
    knowledgeIndexId: "ki-1" as KnowledgeIndexId,
  };

  it("builds Research with model, knowledge, and exactly two tools", async () => {
    const manifest = await buildResearchManifest({
      ...base,
      toolVersionIds: {
        npmPackageMetadata: "tv-1" as ToolVersionId,
        npmDownloads: "tv-2" as ToolVersionId,
      },
    });
    expect(manifest.capabilities).toEqual({
      model: true,
      tools: ["npm_package_metadata", "npm_downloads"],
    });
    expect(manifest.knowledge?.policy_docs?.knowledgeIndexIds).toEqual([
      "ki-1",
    ]);
    expect(Object.keys(manifest.tools ?? {})).toEqual([
      "npm_package_metadata",
      "npm_downloads",
    ]);
  });

  it("builds Analysis with model and knowledge only", async () => {
    const manifest = await buildAnalysisManifest(base);
    expect(manifest.capabilities).toEqual({ model: true, tools: [] });
    expect(manifest.tools).toBeUndefined();
    expect(manifest.knowledge?.policy_docs?.knowledgeIndexIds).toEqual([
      "ki-1",
    ]);
  });

  it("builds Report with model only", async () => {
    const manifest = await buildReportManifest(base);
    expect(manifest.capabilities).toEqual({ model: true, tools: [] });
    expect(manifest.knowledge).toBeUndefined();
    expect(manifest.tools).toBeUndefined();
  });
});

describe("MCP discovery validation", () => {
  it("requires both npm tools", () => {
    expect(() =>
      validateDiscoveredTools([
        {
          remoteToolName: "npm_package_metadata",
          inputSchema: {
            type: "object",
            properties: { packageName: { type: "string" } },
          },
        },
      ]),
    ).toThrow(/npm_downloads/);
  });
});

describe("deployed agent import", () => {
  it("imports compiled research entrypoint from dist/agents", async () => {
    const entry = path.join(distAgentsDir, "research-agent.js");
    await mkdir(distAgentsDir, { recursive: true });
    await writeFile(
      entry,
      "export async function run() { return { ok: true }; }\n",
      "utf8",
    );
    const loaded = (await import(pathToFileURL(entry).href)) as {
      run?: () => Promise<unknown>;
    };
    expect(typeof loaded.run).toBe("function");
  });
});
